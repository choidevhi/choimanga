// 빌드한 ChoiManga를 띄우고 CDP로 화면을 직접 눌러 보는 테스트. 엔진이 진짜로 번역한다(GPU, Ollama).
// 시험 그림(engine\samples의 p1.jpg, koma_orig.jpg)은 새 임시 폴더로 복사해서 쓴다(samples에는 아무것도 쓰지 않는다).
// 데이터 폴더도 임시 폴더를 쓰고 끝나면 지운다. 스크린샷은 _shots\ 에 저장한다.
// 사용: node scripts/e2e.mjs [exe 경로]

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const exe = process.argv[2] ?? join(root, "src-tauri", "target", "release", "ChoiManga.exe");
const engineDir = join(dirname(root), "engine");
const samples = join(engineDir, "samples");
const port = 9337;
const shots = join(root, "_shots");
const work = mkdtempSync(join(tmpdir(), "choimanga-e2e-"));
const data = join(work, "data");
const pages = join(work, "만화 시험");
const outputs = join(pages, "ko");
const webviewData = join(tmpdir(), "choimanga-cdp");
const names = ["p1.jpg", "koma_orig.jpg"];

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const sampleHashes = Object.fromEntries(names.map((name) => [name, sha(join(samples, name))]));

mkdirSync(shots, { recursive: true });
mkdirSync(data, { recursive: true });
mkdirSync(pages, { recursive: true });
rmSync(webviewData, { recursive: true, force: true });

for (const name of names) {
  copyFileSync(join(samples, name), join(pages, name));
}

writeFileSync(join(data, "settings.json"), JSON.stringify({ engineDir, autoStart: true, saveMode: "beside", scale: 0.92 }));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
let passes = 0;

function check(ok, label) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);

  if (ok) {
    passes += 1;
  } else {
    failures += 1;
  }
}

function launch() {
  return spawn(exe, [], { env: { ...process.env, CHOIMANGA_CDP_PORT: String(port), CHOIMANGA_DATA_DIR: data }, stdio: "ignore" });
}

async function connect() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await sleep(500);

    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === "page" && /tauri\.localhost/.test(target.url));

      if (page !== undefined) {
        return new WebSocket(page.webSocketDebuggerUrl);
      }
    } catch {
      // 아직 창이 뜨지 않았다.
    }
  }

  throw new Error("CDP에 붙지 못했습니다");
}

let socket;
const pending = new Map();
let nextId = 1;

async function attach() {
  socket = await connect();
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  socket.addEventListener("message", (event) => {
    const reply = JSON.parse(event.data);
    const waiter = pending.get(reply.id);

    if (waiter !== undefined) {
      pending.delete(reply.id);
      waiter(reply);
    }
  });
}

function send(method, params = {}) {
  const id = nextId;

  nextId += 1;

  return new Promise((resolve) => {
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });

  if (reply.result?.exceptionDetails !== undefined) {
    console.log(`    (식 오류) ${reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text}`);
  }

  return reply.result?.result?.value;
}

async function waitFor(expression, timeout = 60000) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) {
      return true;
    }

    await sleep(300);
  }

  return false;
}

async function theme(mode) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });
  await sleep(300);
}

async function shot(name) {
  await sleep(600);

  const reply = await send("Page.captureScreenshot", { format: "png" });
  const path = join(shots, `${name}.png`);

  writeFileSync(path, Buffer.from(reply.result.data, "base64"));
  console.log(`    스크린샷 ${path}`);
}

async function both(name) {
  await theme("light");
  await shot(`${name}-light`);
  await theme("dark");
  await shot(`${name}-dark`);
  await theme("light");
}

const q = (value) => JSON.stringify(value);
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${q(selector)}); el?.click(); return el !== null; })()`);
const invoke = (command, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${q(command)}, ${JSON.stringify(args)})`);
const toastHas = (text) => `document.querySelector(".hud")?.innerText.includes(${q(text)}) === true`;
const imageSrc = () => evaluate(`document.querySelector("[data-image]")?.getAttribute("src") ?? ""`);

// 이 테스트가 띄운 앱(pid)의 보이는 창 중 제목이 prefix로 시작하는 것에 WM_CLOSE(닫기 단추와 같다).
function closeWindow(pid, prefix) {
  const script = `
Add-Type -Namespace W -Name E -MemberDefinition '
public delegate bool P(System.IntPtr h, System.IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(P cb, System.IntPtr l);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);
'
$found = New-Object System.Collections.ArrayList
[void][W.E]::EnumWindows({ param($h, $l) $p = 0; [void][W.E]::GetWindowThreadProcessId($h, [ref]$p); if ($p -eq ${pid} -and [W.E]::IsWindowVisible($h)) { $sb = New-Object System.Text.StringBuilder 256; [void][W.E]::GetWindowText($h, $sb, 256); if ($sb.ToString().StartsWith('${prefix}')) { [void]$found.Add($h) } }; $true }, [System.IntPtr]::Zero)
foreach ($h in $found) { [void][W.E]::PostMessage($h, 0x10, [System.IntPtr]::Zero, [System.IntPtr]::Zero) }
if ($found.Count -eq 1) { 'sent' } else { 'found ' + $found.Count }`;

  return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim();
}

// 앱(pid)이 띄운 python.exe(엔진) PID들.
function enginePids(pid) {
  const script = `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.ParentProcessId -eq ${pid} } | ForEach-Object { $_.ProcessId }`;

  const pids = [];

  for (const text of execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).split(/\s+/)) {
    if (text !== "") {
      pids.push(Number(text));
    }
  }

  return pids;
}

function alive(pid) {
  const text = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8" });

  return text.includes(String(pid));
}

function hidden(path) {
  const script = `((Get-Item -Force -LiteralPath '${path.replaceAll("'", "''")}').Attributes -band [IO.FileAttributes]::Hidden) -ne 0`;

  return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim() === "True";
}

// 창에 파일을 끌어다 놓은 것과 같은 이벤트(tauri://drag-drop)를 보낸다. 화면은 실제 놓기와 같은 처리기로 받는다.
const drop = (paths) => evaluate(`window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "tauri://drag-drop", payload: { paths: ${JSON.stringify(paths)}, position: { x: 400, y: 300 } } }).then(() => true, (e) => String(e))`);

// 상태(선택, 포커스, 입력 중)를 테두리·outline·안쪽 그림자로 나타내는 CSS 규칙을 찾는다.
const ringRules = `(() => {
  const bad = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (!/:focus|:active|:hover|\\.on\\b|\\[aria-selected|:checked/.test(rule.selectorText)) continue;
      const s = rule.style;
      const outlineStyle = s.getPropertyValue("outline-style");
      const outlineRing = outlineStyle !== "" && outlineStyle !== "none" && !/^0(px)?$/.test(s.getPropertyValue("outline-width"));
      const borderRing = ["top", "right", "bottom", "left"].some((side) => {
        const width = s.getPropertyValue("border-" + side + "-width");
        const style = s.getPropertyValue("border-" + side + "-style");
        const color = s.getPropertyValue("border-" + side + "-color");
        return (width !== "" && !/^0(px)?$/.test(width)) || (style !== "" && style !== "none" && style !== "initial") || (color !== "" && !/^(transparent|initial)$/.test(color));
      });
      const ring = outlineRing || borderRing;
      const inset = /inset/.test(s.getPropertyValue("box-shadow"));
      if (ring || inset) bad.push(rule.selectorText);
    }
  }
  return bad;
})()`;

const noRing = (selector) => `(() => {
  const el = document.querySelector(${q(selector)});
  if (el === null) return "없음";
  const s = getComputedStyle(el);
  const ok = (s.outlineStyle === "none" || s.outlineWidth === "0px") && !s.boxShadow.includes("inset") && s.borderTopWidth === "0px" && s.borderLeftWidth === "0px";
  return ok ? true : [s.outlineStyle, s.outlineWidth, s.boxShadow, s.borderTopWidth].join(" | ");
})()`;

let child = launch();
let exited = false;

child.on("exit", () => {
  exited = true;
});

try {
  await attach();
  check(await waitFor(`document.querySelector("[data-add-files]") !== null`, 20000), "창이 뜸: 파일 넣기 단추");
  check(await evaluate(`document.querySelector("[data-add-files]").innerText.trim() === "파일 넣기" && document.querySelector("[data-add-folder]").innerText.trim() === "폴더 넣기"`), "위 막대: 파일 넣기·폴더 넣기");
  check(await evaluate(`document.querySelector("[data-viewer-empty]") !== null`), "빈 보기 안내");
  await both("0-empty");

  check(await waitFor(`document.querySelector("[data-engine=ready]") !== null`, 240000), "엔진 준비됨");
  console.log(`    엔진 상태: ${await evaluate(`document.querySelector(".topbar").innerText.replaceAll("\\n", " / ")`)}`);
  check(await evaluate(`/RTX|GPU/.test(document.querySelector("[data-engine=ready]").innerText)`), "위 막대: GPU 이름");
  check(await evaluate(`document.querySelector("[data-ollama=on]") !== null`), "위 막대: Ollama 연결됨");

  const enginePid = await invoke("engine_pid");
  const launched = enginePids(child.pid);

  const inner = enginePids(enginePid);

  console.log(`    엔진 안쪽 python: ${inner.join(",") || "(없음)"}`);
  check(enginePid > 0 && launched.length === 1 && launched[0] === enginePid, `엔진 프로세스 하나(PID ${enginePid}, 앱이 띄운 python ${launched.join(",")})`);

  // 끌어다 놓기: 두 장.
  const dropped = await drop(names.map((name) => join(pages, name)));

  check(dropped === true, `끌어다 놓기 이벤트 보냄 ${dropped}`);
  check(await waitFor(`document.querySelectorAll("[data-job]").length === 2`, 10000), "목록에 2장");
  check(await evaluate(`[...document.querySelectorAll("[data-job]")].map((el) => el.dataset.name).join(",") === "koma_orig.jpg,p1.jpg"`), "자연 정렬 순서: koma_orig, p1");
  check(await waitFor(toastHas("2장을 넣었어요"), 3000), "토스트: 2장을 넣었어요");
  check(await evaluate(`document.querySelectorAll(".q-thumb img").length === 2`), "썸네일 2개");

  // 넣으면 바로 시작: 단계 글을 모은다.
  const seen = new Set();
  const started = Date.now();
  const allDone = `document.querySelectorAll("[data-job][data-phase=done]").length === 2`;
  const anyFailed = `document.querySelector("[data-job][data-phase=failed]") !== null`;

  while (Date.now() - started < 900000) {
    const labels = await evaluate(`[...document.querySelectorAll("[data-phase-label]")].map((el) => el.innerText.trim())`);

    for (const label of labels ?? []) {
      seen.add(label);
    }

    if ((await evaluate(allDone)) || (await evaluate(anyFailed))) {
      break;
    }

    await sleep(150);
  }

  console.log(`    본 상태 글: ${[...seen].join(", ")} (${Math.round((Date.now() - started) / 1000)}초)`);

  if (await evaluate(anyFailed)) {
    console.log(`    실패: ${await evaluate(`document.querySelector("[data-job][data-phase=failed]").innerText.replaceAll("\\n", " / ")`)}`);
  }

  check(await evaluate(allDone), "두 장 모두 완료");
  check(seen.has("완료") && ["글자 찾는 중", "읽는 중", "번역 중", "지우는 중", "쓰는 중"].filter((label) => seen.has(label)).length >= 2, "진행 중 단계 글이 바뀜");
  check(await evaluate(`document.querySelector("[data-progress]").dataset.progress === "2/2"`), "전체 진행 완료 2/2");

  for (const name of names) {
    const output = join(outputs, name);
    const json = join(outputs, ".choimanga", name.replace(/\.jpg$/, ".json"));

    check(existsSync(output) && statSync(output).size > 0, `번역본 파일 ${output}`);
    check(existsSync(json), `다시 쓰기용 ${json}`);
    check(sha(join(samples, name)) === sampleHashes[name], `engine\\samples\\${name}은 그대로`);
  }

  check(hidden(join(outputs, ".choimanga")), "작업 폴더 .choimanga는 숨김");

  // p1 보기.
  await click(`[data-job][data-name="p1.jpg"]`);
  check(await waitFor(`document.querySelector("[data-viewer] .v-name")?.innerText === "p1.jpg"`, 3000), "p1 고름");
  check(await waitFor(`document.querySelector("[data-image=translated]")?.complete === true && document.querySelector("[data-image=translated]").naturalWidth > 0`, 5000), "번역본 그림을 asset 프로토콜로 읽음");

  const p1Json = join(outputs, ".choimanga", "p1.json");
  const before = JSON.parse(readFileSync(p1Json, "utf8"));
  const lineCount = before.lines.length;

  console.log(`    p1 대사: ${before.lines.map((line) => `${line.japanese} → ${line.korean}`).join(" | ")}`);
  check(lineCount > 0 && (await evaluate(`document.querySelectorAll("[data-ko]").length`)) === lineCount, `대사 ${lineCount}줄과 입력란 수가 같음`);
  check(await evaluate(`[...document.querySelectorAll(".line-ja")].every((el) => parseFloat(getComputedStyle(el).fontSize) <= 13)`), "일본어는 작은 글씨");
  check(await evaluate(`[...document.querySelectorAll("[data-ko]")].every((el) => el.rows === 1 && el.tagName === "TEXTAREA")`), "한국어 입력란은 한 줄짜리 textarea로 시작");
  check(await evaluate(`document.querySelector("select") === null`), "<select> 없음");

  // 포커스·선택 상태에 테두리가 없는지.
  await evaluate(`document.querySelector("[data-ko='0']").focus()`);
  check((await evaluate(noRing("[data-ko='0']"))) === true, "입력란 포커스에 테두리·outline·안쪽 그림자 없음");
  check(await evaluate(`document.activeElement === document.querySelector("[data-ko='0']") && document.querySelector("[data-line='0']").classList.contains("on")`), "입력란을 누르면 그 대사가 골라짐");
  check(await evaluate(`document.querySelector("[data-box='0']").classList.contains("on")`), "고른 대사의 상자가 그림 위에 표시됨");
  check(
    await evaluate(`(() => { const s = getComputedStyle(document.querySelector("[data-box='0']")); return s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.borderTopWidth === "0px" && s.outlineStyle === "none" && s.boxShadow === "none"; })()`),
    "상자 표시는 은은한 채움(테두리 없음)",
  );
  check((await evaluate(noRing(".q-row.on"))) === true, "목록에서 고른 장도 테두리 없음");

  const rings = await evaluate(ringRules);

  check(Array.isArray(rings) && rings.length === 0, `상태 CSS에 테두리·outline·inset 규칙 없음 ${JSON.stringify(rings)}`);

  const height0 = await evaluate(`document.querySelector("[data-ko='0']").getBoundingClientRect().height`);

  await evaluate(`(() => { const el = document.querySelector("[data-ko='0']"); el.focus(); el.select(); })()`);
  await send("Input.insertText", { text: "시험으로 고친 대사예요. 한 줄보다 길게 써서 입력란이 늘어나는지 봐요. 조금 더 길게 써 봐요." });
  await sleep(300);

  const height1 = await evaluate(`document.querySelector("[data-ko='0']").getBoundingClientRect().height`);

  check(height1 > height0, `긴 글을 쓰면 입력란이 늘어남 (${height0} → ${height1})`);
  await evaluate(`(() => { const el = document.querySelector("[data-ko='0']"); el.focus(); el.select(); })()`);
  await send("Input.insertText", { text: "시험으로 고친 대사" });
  await sleep(200);

  const outputP1 = join(outputs, "p1.jpg");
  const hashBefore = sha(outputP1);
  const srcBefore = await imageSrc();

  await both("1-viewer-editing");
  await click("[data-rewrite]");
  check(await waitFor(toastHas("다시 썼어요"), 60000), "다시 쓰기: 토스트");

  const afterRewrite = JSON.parse(readFileSync(p1Json, "utf8"));
  const hashRewrite = sha(outputP1);
  const srcRewrite = await imageSrc();

  check(afterRewrite.lines[0].korean === "시험으로 고친 대사", `다시 쓰기: 엔진 기록의 첫 대사 "${afterRewrite.lines[0].korean}"`);
  check(hashRewrite !== hashBefore, "다시 쓰기: 번역본 파일이 바뀜");
  check(srcRewrite !== srcBefore && /\?v=\d+$/.test(srcRewrite), `다시 쓰기: 그림을 새로 읽음 (${srcBefore.split("?")[1]} → ${srcRewrite.split("?")[1]})`);
  check(await waitFor(`document.querySelector("[data-image=translated]")?.complete === true`, 5000), "다시 쓰기: 새 그림 표시");

  // 글자 크기 단계.
  check(await evaluate(`document.querySelector("[data-seg=scale] .on").dataset.value === "0.92"`), "글자 크기: 보통이 골라져 있음");
  await click(`[data-seg=scale] [data-value="1.05"]`);
  check(await waitFor(toastHas("글자 크기를 바꿔 다시 썼어요"), 60000), "글자 크기: 크게로 바꾸면 바로 다시 씀");

  const hashBig = sha(outputP1);

  check(hashBig !== hashRewrite, "글자 크기: 번역본 파일이 바뀜");
  check(JSON.parse(readFileSync(join(data, "settings.json"), "utf8")).scale === 1.05, "글자 크기: 설정에 1.05 저장");
  check(await evaluate(`document.querySelector("[data-seg=scale] .on").dataset.value === "1.05"`), "글자 크기: 크게가 골라짐");
  check(JSON.parse(readFileSync(p1Json, "utf8")).lines[0].korean === "시험으로 고친 대사", "글자 크기: 고친 대사는 그대로");
  check((await evaluate(noRing(`[data-seg=scale] .on`))) === true, "글자 크기: 고른 단계에 테두리 없음");
  await both("2-viewer-done");

  // 번역본/원본 전환.
  await click(`[data-seg=show] [data-value=original]`);
  check(await waitFor(`document.querySelector("[data-image=original]")?.getAttribute("src").includes("p1.jpg")`, 3000), "원본 보기");
  await click(`[data-seg=show] [data-value=translated]`);
  check(await waitFor(`document.querySelector("[data-image=translated]") !== null`, 3000), "번역본 보기");

  // 설정 화면.
  await click("[data-open-settings]");
  check(await waitFor(`document.querySelector("[data-screen=settings]:not([hidden]) h2")?.innerText === "설정"`, 3000), "설정 화면");
  check(await evaluate(`document.querySelector("[data-font-preview]").innerText === "다녀왔어!"`), "글꼴 미리보기 다녀왔어!");
  check(await waitFor(`document.querySelector("[data-picker=model]") !== null`, 3000), "번역 모델 고르기");
  await click("[data-picker=model]");
  check(await waitFor(`document.querySelector("[data-sheet=model] [data-option='ko-edit']")?.classList.contains("on") === true`, 3000), "모델 목록에 ko-edit(골라짐)");
  check((await evaluate(noRing(`[data-sheet=model] .pick-row.on`))) === true, "고른 모델 줄에 테두리 없음");
  await both("3-settings-model");
  await evaluate(`document.querySelector("[data-sheet=model]").click()`);
  check(await waitFor(`document.querySelector("[data-picker=font]") !== null && document.querySelector("[data-picker=font]").innerText.trim() !== ""`, 3000), "글꼴 고르기");
  await click("[data-picker=font]");
  check(await waitFor(`document.querySelectorAll("[data-sheet=font] [data-option]").length > 1`, 60000), `글꼴 목록 ${await evaluate(`document.querySelectorAll("[data-sheet=font] [data-option]").length`)}개`);
  check(await evaluate(`document.querySelector("[data-sheet=font] .pick-row.on")?.dataset.option.toLowerCase().endsWith("malgunbd.ttf") === true`), "기본 글꼴 맑은 고딕 Bold가 골라짐");
  check(
    await evaluate(`document.querySelectorAll("[data-sheet=font] .pick-row.on").length === 1 && !/\\.tt[fc]$/i.test(document.querySelector("[data-sheet=font] .pick-row.on .clip").innerText)`),
    `고른 글꼴이 목록의 글꼴 이름으로 보임(${await evaluate(`document.querySelector("[data-sheet=font] .pick-row.on .clip")?.innerText`)})`,
  );
  check(!(await evaluate(`document.querySelector("[data-screen=settings]").innerText.includes("한글 글꼴 목록에 없어요")`)), "기본 글꼴이 엔진 글꼴 목록과 맞음");
  await evaluate(`document.querySelector("[data-sheet=font]").click()`);
  check(await evaluate(`document.querySelector("[data-engine-dir]").innerText === ${q(engineDir)}`), "엔진 폴더 표시");
  check(await evaluate(`document.querySelector("[data-seg=save-mode] .on").dataset.value === "beside"`), "저장 위치: 원본 옆");
  await both("3-settings");
  await evaluate(`document.querySelector("[data-screen=settings]").scrollTop = 100000`);
  await both("3-settings-bottom");
  await click("[data-back]");
  check(await waitFor(`document.querySelector("[data-screen=main]:not([hidden])") !== null`, 3000), "설정에서 돌아가기");

  // 끝난 것 지우기.
  await click("[data-clear]");
  check(await waitFor(`document.querySelectorAll("[data-job]").length === 0 && document.querySelector("[data-viewer-empty]") !== null`, 3000), "끝난 것 지우기");

  const logFile = join(data, "engine.log");

  check(existsSync(logFile) && statSync(logFile).size > 0, `엔진 stderr가 로그 파일로 감 (${existsSync(logFile) ? statSync(logFile).size : 0} 바이트)`);

  // 창 닫기: 엔진에 shutdown을 보내고 그 PID만 끝낸다.
  socket.close();
  check(closeWindow(child.pid, "ChoiManga") === "sent", "창 닫기(WM_CLOSE)");

  for (let attempt = 0; attempt < 60 && !exited; attempt += 1) {
    await sleep(250);
  }

  check(exited, "앱이 끝남");
  await sleep(500);
  check(!alive(enginePid), `엔진(PID ${enginePid})도 끝남`);
  check(inner.every((pid) => !alive(pid)), `엔진이 띄운 python(${inner.join(",") || "없음"})도 끝남`);
} finally {
  socket?.close();

  if (!exited) {
    // 이 테스트가 띄운 앱 프로세스만 닫는다.
    child.kill();
    await sleep(2500);
  }

  rmSync(work, { recursive: true, force: true });
  rmSync(webviewData, { recursive: true, force: true });
  console.log(`임시 폴더 지움: ${!existsSync(work)}`);
}

console.log(failures === 0 ? `모두 통과 (${passes}개)` : `${failures}개 실패, ${passes}개 통과`);
process.exit(failures === 0 ? 0 : 1);
