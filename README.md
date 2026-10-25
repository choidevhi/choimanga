# ChoiManga

일본 만화 그림의 일본어를 이 PC 안에서만 읽고 번역해 한국어로 덮어 주는 개인용 Windows 앱. 파일이나 폴더를 넣으면 번역본 폴더가 생긴다. 앱 명세는 `SPEC.md`.

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

`p1.jpg`·`p2.jpg`(직접 만든 말풍선·설명문), `koma_orig.jpg`·`sewing.jpg`(1953년 4컷, 퍼블릭 도메인), `biwasshi.jpg`(ビワッシー 4컷, CC BY-SA 4.0), `aso.png`(아소 유타카 4컷 원화, CC0, 대사 없음). 모두 Wikimedia Commons.

## 라이선스 메모

comic-text-detector 모델(manga-image-translator 배포, GPL-3.0 저장소), manga-ocr(Apache-2.0), big-lama(Apache-2.0), 맑은 고딕(Windows 기본 글꼴). 개인용으로만 쓴다.
