# ChoiManga

일본 만화 그림의 일본어를 PC 안에서만 읽고 번역해 한국어로 덮어 주는 개인용 Windows 앱. 사용자가 파일이나 폴더를 직접 넣는다.

## 구성

- `engine\` Python 엔진 (이미 있음, 손대지 않는다). `engine\.venv\Scripts\python.exe -m choimanga.server`를 작업 폴더 `engine\`에서 띄우면 표준 입출력으로 JSON 한 줄씩 주고받는다. 네트워크 포트 없음. 번역은 Ollama(127.0.0.1:11434)만 부른다.
- `app\` Tauri 2 + React 19 + TypeScript 앱 (새로 만든다). 구조와 디자인은 `C:\Users\main\Desktop\choisave\desktop`(TDS, pnpm은 `corepack pnpm`)을 따른다.

## 엔진 규약 (engine\choimanga\server.py)

시작하면 `{"event":"ready"}` 한 줄. 요청은 한 번에 하나씩 보낸다(엔진은 순서대로 처리, GPU 하나).

| 요청 | 응답 data |
| --- | --- |
| `{"id","cmd":"status"}` | `{"device":"cuda","gpu":"NVIDIA GeForce RTX 5070 Ti","models":["ko-edit",...],"ollama":null 또는 오류 문자열}` |
| `{"id","cmd":"fonts"}` | `[{"path","name"}]` 한글을 쓸 수 있는 설치 글꼴 |
| `{"id","cmd":"process","source","output","options":{"model","font","scale"}}` | Page (아래) |
| `{"id","cmd":"retypeset","output","korean":[...] 또는 null,"options":{...}}` | Page. 번역문(같은 순서)이나 글자 크기·글꼴만 바꿔 다시 쓴다(1초 안팎) |
| `{"id","cmd":"shutdown"}` | null, 그리고 끝남 |

- 성공 `{"id","ok":true,"data":...}`, 실패 `{"id","ok":false,"error":"..."}`.
- 진행 `{"id","event":"step","step":"detect"|"ocr"|"translate"|"erase"|"typeset"}` (글자 찾기, 읽기, 번역, 지우기, 한글 쓰기).
- Page = `{"source","output","width","height","lines":[{"box":[l,t,r,b],"vertical":bool,"japanese","korean","letter"}]}`.
- options 기본값: model `ko-edit`, font `C:\Windows\Fonts\malgunbd.ttf`, scale `0.92`. 빈 값이면 기본값.
- 첫 process는 모델을 올리느라 10~20초 더 걸린다. 한 장은 보통 3~15초.
- 엔진은 출력 옆에 `.choimanga\<이름>.json`과 `.clean.png`를 남긴다(다시 쓰기용). 출력 폴더 목록에 이 숨김 작업 폴더는 보이지 않게 한다.
- stderr는 로그다(경고가 많다). 앱 로그 파일로 넘기고 화면에는 안 보인다.

## 화면 (TDS, 라이트·다크, 창 최소 960x640)

1. 위 막대: "파일 넣기", "폴더 넣기" 버튼과 엔진 상태(GPU 이름, Ollama 연결 여부). Ollama가 꺼져 있으면 "Ollama 켜기" 버튼(`C:\Users\main\AppData\Local\Programs\Ollama\ollama app.exe`를 분리된 프로세스로 실행).
2. 창 어디에 끌어다 놓아도 추가된다. 폴더는 하위 폴더까지 jpg·jpeg·png·webp를 자연 정렬(1, 2, 10)로 넣는다.
3. 왼쪽 목록: 썸네일, 파일 이름, 상태(대기, 글자 찾는 중, 읽는 중, 번역 중, 지우는 중, 쓰는 중, 완료, 실패와 이유). 위에 전체 진행(완료/전체)과 "시작", "멈추기"(지금 장까지 하고 멈춤), "끝난 것 지우기". 넣으면 바로 시작하는 설정이 기본 켜짐.
4. 오른쪽 보기: 고른 장을 화면에 맞춰 보여 주고 "번역본/원본" 전환(번역 전이면 원본만). 아래(또는 옆)에 대사 목록: 일본어(작게, 흐린 글씨)와 한국어 입력란. 고치고 "다시 쓰기"를 누르면 retypeset 후 그림을 새로 읽는다(캐시 무효화). 대사를 고르면 그림에서 그 상자를 은은한 채움으로 표시.
5. 글자 크기: 아주 작게 0.7, 작게 0.82, 보통 0.92, 크게 1.05 단계 선택. 바꾸면 현재 장에 바로 다시 쓰기, 이후 장에도 적용(설정에 기억).
6. 설정 화면: 번역 모델(엔진 status의 models 중), 글꼴(fonts 목록, 미리보기 글자 "다녀왔어!"), 저장 위치(기본: 원본 폴더 옆 `<폴더이름>_ko`, 파일 하나면 원본 폴더 안 `ko` 폴더; 또는 고정 폴더), 넣으면 바로 시작, 엔진 폴더(기본 `C:\Users\main\Desktop\choimanga\engine`). 설정은 앱 데이터 폴더 JSON.
7. 완료된 장에서 "폴더 열기"(탐색기에서 출력 파일 선택).

## 규칙

- 모든 화면 글은 한국어. 개인정보: 앱은 Ollama(127.0.0.1) 말고 아무 데도 접속하지 않는다.
- 상태(선택, 포커스, 입력 중)를 테두리·outline·inset 그림자로 표시하지 않는다(특히 라이트 검은 테두리, 다크 흰 테두리). 배경 채움, 은은한 색 변화로 표시. 입력란 포커스에도 테두리·강조색 없음.
- 입력란은 작고 낮게. textarea는 한 줄 높이로 시작해 내용에 따라 늘어난다.
- `<select>`나 시스템 기본 위젯 대신 직접 만든 TDS 고르기(ChoiSave 방식). 파일·폴더 고르기만 시스템 대화상자.
- 그림 표시는 Tauri asset 프로토콜(convertFileSrc)로, 다시 쓴 뒤에는 `?v=` 붙여 새로 읽기.
- 엔진 프로세스는 앱이 하나만 띄우고, 앱이 꺼질 때 shutdown 후 끝낸다(그 PID만). 콘솔 창이 뜨지 않게(CREATE_NO_WINDOW). 엔진이 죽으면 다시 띄우고 그 장은 실패로 표시.
- 설치본: NSIS, currentUser, productName ChoiManga, identifier com.choidev.manga, 버전 0.1.0.
