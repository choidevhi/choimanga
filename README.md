# ChoiManga

일본 만화 그림의 일본어를 이 PC 안에서만 읽고 번역해 한국어로 덮어 주는 개인용 Windows 앱. 파일이나 폴더를 넣으면 번역본 폴더가 생긴다. 앱 명세는 `SPEC.md`.

## 처음 설치하기

저장소에는 모델과 설치 파일이 들어 있지 않다. 아래 순서로 한 번 준비하면 그 뒤로는 인터넷 없이 돈다.

**필요한 것**

- Windows 10/11 64비트
- NVIDIA 그래픽카드(VRAM 12GB 이상 권장: 번역 모델 약 7GB + 엔진 약 2GB). RTX 50 시리즈는 CUDA 12.8 이상을 지원하는 최신 드라이버가 필요하다. 그래픽카드가 없으면 CPU로도 돌지만 한 장에 몇 분 걸린다.
- 디스크 약 15GB(엔진 환경과 모델 6GB, 번역 모델 7GB)
- [uv](https://docs.astral.sh/uv/) (`winget install astral-sh.uv`), [Ollama](https://ollama.com/download)
- 앱을 직접 빌드할 때만: [Rust](https://rustup.rs/), Node.js 22 이상(pnpm은 `corepack`으로)

**1. 저장소 받기**

```
git clone https://github.com/choidevhi/choimanga.git %USERPROFILE%\Desktop\choimanga
```

앱은 엔진을 `%USERPROFILE%\Desktop\choimanga\engine`에서 찾는다. 다른 곳에 두면 앱 설정의 "엔진 폴더"를 바꾼다.

**2. 엔진 환경과 모델** (약 6GB 받음)

```
powershell -ExecutionPolicy Bypass -File engine\setup.ps1
```

Python 3.12 가상환경(`engine\.venv`), CUDA용 torch, 글자 찾기·읽기·지우기 모델(`engine\models`)을 준비한다.

**3. 번역 모델 (Ollama)**

앱은 Ollama에 있는 모델 이름으로 번역한다. 기본 이름은 `ko-edit`이고, 설정에서 Ollama에 있는 다른 모델로 바꿀 수 있다. 시험에 쓴 모델은 gemma 12B 계열이다.

```
ollama pull huihui_ai/gemma-4-abliterated:12b
ollama cp huihui_ai/gemma-4-abliterated:12b ko-edit
```

다른 모델을 써도 된다(`ollama pull <모델>` 뒤 앱 설정에서 고르기). 한국어를 잘하는 10B 이상 모델이 자연스럽다. 번역 지시문은 엔진(`engine\choimanga\translate.py`)이 보내므로 Modelfile을 따로 만들 필요는 없다.

**4. 앱 빌드와 설치**

```
cd app
corepack pnpm install
corepack pnpm tauri build
```

`app\src-tauri\target\release\bundle\nsis\ChoiManga_<버전>_x64-setup.exe`를 실행해 설치한다(사용자 계정에만 설치, 관리자 권한 필요 없음).

**5. 쓰기**

Ollama를 켜 두고 ChoiManga를 연다. 위쪽에 그래픽카드 이름과 "Ollama 연결됨"이 보이면 준비된 것이다. 그림 파일이나 폴더를 창에 끌어다 놓으면 번역을 시작하고, 번역본은 원본 폴더 옆 `<폴더이름>_ko`(파일 하나면 같은 폴더 안 `ko`)에 저장된다.

## 엔진 (`engine\`)

한 장을 이렇게 처리한다. 모두 로컬이고, 모델은 `setup.ps1`이 처음 한 번만 받는다.

1. **글자 찾기**: comic-text-detector(ONNX, CPU). 블록 머리(YOLO)가 놓치는 손글씨·옛 인쇄는 줄 머리(DB) 영역을 직접 묶는다. 같은 세로줄 토막은 잇고, 이웃한 줄은 하나로 묶되 사이에 어두운 선(말풍선 테두리)이 있으면 밝은 픽셀 연결로 판단해 나눈다. 세로로 긴 그림(웹툰, 4컷 세로 줄)은 가로의 1.5배 높이 조각으로 나눠 읽는다.
2. **읽기**: manga-ocr(kha-white/manga-ocr-base, CUDA). 말풍선 한 덩어리를 통째로 읽는다(세로쓰기·여러 줄·물음표까지). 한 글자짜리 찌꺼기(그림 획)는 블록 머리가 찾은 것이 아니면 버린다.
3. **번역**: Ollama `ko-edit`(gemma 12B, 무검열). 한 페이지 대사를 읽는 순서(줄은 위에서 아래, 줄 안에서는 오른쪽에서 왼쪽)대로 번호 붙여 한 번에 보내 맥락을 살린다. 번호가 어긋나면 한 줄씩, 가나가 남은 줄은 그 줄만 다시. `ko-trans`(hy-mt 7B)는 일본어를 그대로 남기는 일이 많아 기본값에서 뺐다.
4. **지우기**: 탐지 마스크 + 블록에 닿은 어두운 획 덩어리(테두리처럼 큰 획은 제외). 둘레가 단색이면 그 색으로 채우고(LaMa는 단색 말풍선에 희미한 얼룩을 남김), 아니면 LaMa(big-lama TorchScript, CUDA)로 그림을 이어 그린다.
5. **한글 쓰기**: 말풍선 안쪽 범위를 줄마다 가운데에서 테두리까지 재서 대부분의 줄이 허락하는 폭으로 정한다(꼬리·비스듬한 테두리 무시). 원래 일본어 글자보다 크지 않게, 단어는 되도록 안 끊고, 문장부호로 줄을 시작하지 않는다. 검은 글씨에 흰 테두리. 기본 글꼴 맑은 고딕 굵게.

```
powershell -File engine\setup.ps1          # 환경과 모델 (한 번)
cd engine; .venv\Scripts\python.exe -m pytest -q tests
cd engine; .venv\Scripts\python.exe -m choimanga.server   # 앱이 띄우는 것
```

RTX 5070 Ti에서 한 장 3~15초(첫 장은 모델 올리느라 더). torch 2.14 + CUDA 13(RTX 50은 sm_120이라 CUDA 12.8 이상 필요).

## 시험 그림 (`engine\samples\`)

- `p1.jpg`, `p2.jpg`: 직접 만든 말풍선과 설명문.
- `sewing.jpg`, `koma_orig.jpg`(그 일부): 1953년 4컷 「ハツ子さん」, 퍼블릭 도메인. [Commons](https://commons.wikimedia.org/wiki/File:4-frame_comic_strip_about_sewing_mashine_1953.jpg)
- `biwasshi.jpg`: 「ビワッシー４コママンガ」, 작가 松井高, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). [Commons](https://commons.wikimedia.org/wiki/File:%E3%83%93%E3%83%AF%E3%83%83%E3%82%B7%E3%83%BC%EF%BC%94%E3%82%B3%E3%83%9E%E3%83%9E%E3%83%B3%E3%82%AC.jpg). 이 파일은 저장소의 MIT 라이선스가 아니라 CC BY-SA 4.0을 따른다.
- `aso.png`: 아소 유타카(麻生豊) 4컷 원화, CC0, 대사 없음. [Commons](https://commons.wikimedia.org/wiki/File:%E9%BA%BB%E7%94%9F%E8%B1%8A%E3%80%8C%E9%99%BD%E5%A4%AA%E5%90%9B%EF%BC%88%E3%81%8C%E3%81%A3%E3%81%A1%E3%82%83%E3%82%93%EF%BC%89%E5%8E%9F%E7%94%BB%E3%80%8D%E3%82%88%E3%82%8A.png)

## 라이선스

코드는 MIT(`LICENSE`). 모델은 저장소에 없고 `setup.ps1`이 받는다: comic-text-detector(manga-image-translator 배포, GPL-3.0), manga-ocr-base(Apache-2.0), big-lama(Apache-2.0). 번역은 사용자가 Ollama에 둔 모델을 쓴다. 기본 글꼴은 Windows의 맑은 고딕.
