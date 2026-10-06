import io
import json
import os
import sys
import tempfile
import uuid

from flask import Flask, jsonify, request, send_file, render_template

import excel_builder
import license_check
import pdf_export

# PyInstaller(--onefile)로 얼렸을 때 __file__은 매 실행마다 새로 풀리는 임시 폴더(_MEIPASS)를
# 가리켜서, 거기에 settings.json/license.key를 두면 프로그램을 껐다 켤 때마다 사라진다.
# 그래서 "실행파일 자체가 있는 폴더"를 따로 계산해 설정/라이선스는 거기에 저장·조회한다.
if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SETTINGS_PATH = os.path.join(BASE_DIR, "settings.json")

app = Flask(__name__)
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0  # 개발 중인 작업사진 앱/갤러리가 모바일에 캐시돼 옛 버전이 보이는 문제 방지

LICENSE_OK, LICENSE_INFO, LICENSE_ERROR = license_check.load_and_verify(BASE_DIR)


@app.before_request
def _require_license():
    if LICENSE_OK:
        return None
    if request.path.startswith("/static/"):
        return None
    return render_template("license_error.html", error=LICENSE_ERROR), 403


@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


def load_settings():
    if os.path.exists(SETTINGS_PATH):
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"project_name": "", "company_name": "", "work_title": "", "supabase_url": "", "supabase_key": ""}


def save_settings(data):
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/license", methods=["GET"])
def get_license():
    return jsonify({"ok": LICENSE_OK, "info": LICENSE_INFO, "error": LICENSE_ERROR})


@app.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(load_settings())


@app.route("/api/settings", methods=["POST"])
def post_settings():
    data = request.get_json(force=True)
    settings = {
        "project_name": (data.get("project_name") or "").strip(),
        "company_name": (data.get("company_name") or "").strip(),
        "work_title": (data.get("work_title") or "").strip(),
        # 갤러리 불러오기를 쓰려면 반드시 채워야 한다(비워두면 연결 안 됨) — 사용 중인
        # 현장의 Supabase URL/key를 여기 저장해둔다.
        "supabase_url": (data.get("supabase_url") or "").strip(),
        "supabase_key": (data.get("supabase_key") or "").strip(),
    }
    save_settings(settings)
    return jsonify(settings)


def _parse_pages(files):
    """multipart 요청에서 pages 메타(JSON)와 사진 파일을 조합해 excel_builder가 원하는 구조로 변환.
    사진 한 장 = 세트 한 개(고유 dwg/location/content/date)이므로, sets 배열 순서가
    레이아웃 4는 [top_left, top_right, bottom_left, bottom_right], 레이아웃 2는 [top, bottom]이어야 한다."""
    meta = json.loads(request.form["pages"])
    pages = []
    for page in meta:
        sets = []
        for set_meta in page.get("sets") or []:
            photo_key = set_meta.get("photo_key")
            file_storage = files.get(photo_key) if photo_key else None
            sets.append({
                "dwg": set_meta.get("dwg", ""),
                "location": set_meta.get("location", ""),
                "content": set_meta.get("content", ""),
                "date": set_meta.get("date", ""),
                "photo": file_storage.read() if file_storage else None,
            })
        pages.append({"layout": page.get("layout", "4"), "sets": sets})
    return pages


@app.route("/api/generate", methods=["POST"])
def generate():
    fmt = request.form.get("format", "xlsx")
    settings = json.loads(request.form.get("settings", "{}"))
    pages = _parse_pages(request.files)

    wb = excel_builder.build_workbook(pages, settings)

    work_title = (settings.get("work_title") or "").strip() or "사진대지"
    base_name = f"{work_title}_사진대지"

    if fmt == "xlsx":
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return send_file(
            buf,
            as_attachment=True,
            download_name=f"{base_name}.xlsx",
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    # pdf: 임시 xlsx로 저장 후 Excel COM으로 변환
    tmp_dir = tempfile.mkdtemp(prefix="photo_sheet_")
    tmp_xlsx = os.path.join(tmp_dir, f"{uuid.uuid4().hex}.xlsx")
    tmp_pdf = os.path.join(tmp_dir, f"{uuid.uuid4().hex}.pdf")
    wb.save(tmp_xlsx)
    pdf_export.xlsx_to_pdf(tmp_xlsx, tmp_pdf)

    with open(tmp_pdf, "rb") as f:
        pdf_bytes = f.read()

    try:
        os.remove(tmp_xlsx)
        os.remove(tmp_pdf)
        os.rmdir(tmp_dir)
    except OSError:
        pass

    return send_file(
        io.BytesIO(pdf_bytes),
        as_attachment=True,
        download_name=f"{base_name}.pdf",
        mimetype="application/pdf",
    )


if __name__ == "__main__":
    if not LICENSE_OK:
        print("=" * 60)
        print("[라이선스 오류]", LICENSE_ERROR)
        print("=" * 60)
    else:
        print(f"라이선스 확인됨: {LICENSE_INFO['customer']} ({LICENSE_INFO['expires']}까지)")

    print("서버를 시작합니다... http://127.0.0.1:5183/")

    # exe로 실행될 때만 브라우저를 자동으로 띄운다(python app.py로 개발할 땐 필요 없음 — 매번
    # 코드 고치고 재시작할 때마다 탭이 새로 열리면 번거롭다).
    if getattr(sys, "frozen", False):
        import threading
        import webbrowser

        threading.Timer(1.2, lambda: webbrowser.open("http://127.0.0.1:5183/")).start()

    # 0.0.0.0: 같은 네트워크(사무실 와이파이 등)의 다른 PC에서도 이 PC의 LAN IP로 접속 가능
    # debug=True로 0.0.0.0에 띄우면 같은 네트워크의 누구나 Werkzeug 디버거(임의 코드 실행)에
    # 접근할 수 있어 보안 위험이 크다 — 반드시 False로 배포한다(2026-09-28 수정).
    app.run(host="0.0.0.0", port=5183, debug=False)
