import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { api, message, type Font, type SaveMode, type Settings, type Status } from "./api";
import { Icon } from "./icons";
import { Picker, Segmented, Switch, type PickOption } from "./ui";
import { fileName, samePath, scaleKey, scales, type ScaleKey } from "./view";

const saveModes = [
  { value: "beside", label: "원본 옆" },
  { value: "fixed", label: "고정 폴더" },
] as const;

const PREVIEW = "다녀왔어!";

/** 글꼴 파일을 웹뷰에 올려 미리보기 글꼴 이름을 돌려준다. 못 올리면 null(기본 글꼴로 보인다). */
function usePreviewFont(path: string): string | null {
  const [family, setFamily] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const name = `preview-${Array.from(path, (character) => character.charCodeAt(0).toString(36)).join("").slice(-40)}`;
    const face = new FontFace(name, `url("${convertFileSrc(path)}")`);

    setFamily(null);
    face.load().then(
      (loaded) => {
        document.fonts.add(loaded);

        if (alive) {
          setFamily(name);
        }
      },
      () => {
        if (alive) {
          setFamily(null);
        }
      },
    );

    return () => {
      alive = false;
    };
  }, [path]);

  return family;
}

type Props = {
  settings: Settings;
  defaults: Settings;
  status: Status | null;
  fonts: Font[] | null;
  onFonts: (next: Font[]) => void;
  onSave: (next: Settings) => Promise<Settings>;
  onBack: () => void;
  version: string;
  log: string;
  toast: (text: string, ok?: boolean) => void;
};

export function SettingsScreen({ settings, defaults, status, fonts, onFonts, onSave, onBack, version, log, toast }: Props) {
  const family = usePreviewFont(settings.font);

  useEffect(() => {
    if (fonts === null) {
      api.fonts().then(onFonts, (cause: unknown) => toast(message(cause), false));
    }
  }, [fonts, onFonts, toast]);

  const save = (change: Partial<Settings>) => {
    onSave({ ...settings, ...change }).catch((cause: unknown) => toast(message(cause), false));
  };

  async function pick(title: string, start: string, apply: (folder: string) => Partial<Settings>) {
    try {
      const folder = await api.pickFolder(title, start);

      if (folder !== null) {
        save(apply(folder));
      }
    } catch (cause) {
      toast(message(cause), false);
    }
  }

  const models: PickOption[] = (status?.models ?? []).map((model) => ({ value: model, label: model }));

  if (!models.some((option) => option.value === settings.model)) {
    models.unshift({ value: settings.model, label: settings.model, sub: "지금 Ollama에 없을 수 있어요" });
  }

  const fontOptions: PickOption[] = (fonts ?? []).map((font) => ({ value: font.path, label: font.name, sub: fileName(font.path) }));
  const currentFont = fonts?.find((font) => samePath(font.path, settings.font));
  const fontValue = currentFont?.path ?? settings.font;

  if (currentFont === undefined) {
    fontOptions.unshift({ value: settings.font, label: fileName(settings.font) });
  }

  return (
    <div className="page">
      <div className="title">
        <button type="button" className="text-btn back" data-back onClick={onBack}>
          <Icon.Back />
          돌아가기
        </button>
        <h2>설정</h2>
      </div>

      <div className="section">
        <div className="section-label">번역</div>
        <div className="group">
          <div className="row">
            <div className="grow">
              번역 모델
              <div className="sub">Ollama에 있는 모델 중에서 골라요. 기본은 ko-edit예요.</div>
            </div>
            <Picker title="번역 모델" name="model" options={models} value={settings.model} empty="Ollama가 켜져 있어야 목록이 보여요" onChange={(model) => save({ model })} />
          </div>
          <div className="row">
            <div className="grow">
              글꼴
              <div className="preview" data-font-preview style={family === null ? undefined : { fontFamily: `"${family}"` }}>
                {PREVIEW}
              </div>
            </div>
            <Picker
              title="글꼴"
              name="font"
              options={fontOptions}
              value={fontValue}
              empty={fonts === null ? "글꼴 목록을 읽는 중이에요" : "한글을 쓸 수 있는 글꼴이 없어요"}
              onChange={(font) => save({ font })}
            />
          </div>
          <div className="row">
            <div className="grow">
              글자 크기
              <div className="sub">바꾸면 보고 있는 장을 바로 다시 쓰고, 다음 장에도 써요.</div>
            </div>
            <Segmented<ScaleKey> name="settings-scale" small options={scales} value={scaleKey(settings.scale)} onChange={(key) => save({ scale: Number(key) })} />
          </div>
        </div>
        {currentFont === undefined && fonts !== null ? <div className="footnote">고른 글꼴 파일이 한글 글꼴 목록에 없어요.</div> : null}
      </div>

      <div className="section">
        <div className="section-label">저장</div>
        <div className="group">
          <div className="row">
            <div className="grow">
              저장 위치
              <div className="sub">
                {settings.saveMode === "beside" ? "폴더는 그 옆 <폴더이름>_ko, 파일 하나는 같은 폴더 안 ko 폴더에 저장해요." : "고른 폴더 한 곳에 저장해요."}
              </div>
            </div>
            <Segmented<SaveMode>
              name="save-mode"
              small
              options={saveModes}
              value={settings.saveMode}
              onChange={(saveMode) => {
                if (saveMode === "fixed" && settings.fixedFolder.trim() === "") {
                  void pick("번역본을 저장할 폴더 고르기", "", (fixedFolder) => ({ saveMode: "fixed", fixedFolder }));
                } else {
                  save({ saveMode });
                }
              }}
            />
          </div>
          {settings.saveMode === "fixed" ? (
            <div className="row">
              <div className="grow">
                고정 폴더
                <div className="sub clip" data-fixed-folder title={settings.fixedFolder}>
                  {settings.fixedFolder}
                </div>
              </div>
              <button type="button" className="outlined small" onClick={() => void pick("번역본을 저장할 폴더 고르기", settings.fixedFolder, (fixedFolder) => ({ fixedFolder }))}>
                <Icon.Folder />
                바꾸기
              </button>
            </div>
          ) : null}
          <div className="row">
            <div className="grow">
              넣으면 바로 시작
              <div className="sub">그림을 넣자마자 번역을 시작해요.</div>
            </div>
            <Switch on={settings.autoStart} label="넣으면 바로 시작" onChange={(autoStart) => save({ autoStart })} />
          </div>
        </div>
        <div className="footnote">이미 넣은 장은 넣을 때 정한 위치에 저장해요.</div>
      </div>

      <div className="section">
        <div className="section-label">엔진</div>
        <div className="group">
          <div className="row">
            <div className="grow">
              엔진 폴더
              <div className="sub clip" data-engine-dir title={settings.engineDir}>
                {settings.engineDir}
              </div>
            </div>
            {settings.engineDir !== defaults.engineDir ? (
              <button type="button" className="text-btn small" onClick={() => save({ engineDir: defaults.engineDir })}>
                기본값
              </button>
            ) : null}
            <button type="button" className="outlined small" onClick={() => void pick("엔진 폴더 고르기", settings.engineDir, (engineDir) => ({ engineDir }))}>
              <Icon.Folder />
              바꾸기
            </button>
          </div>
          <div className="row">
            <div className="grow">
              처리 장치
              <div className="sub">{status === null ? "엔진 준비 중" : `${status.gpu ?? "CPU"} (${status.device})`}</div>
            </div>
          </div>
        </div>
        <div className="footnote">{`엔진 기록: ${log}\n앱은 Ollama(127.0.0.1) 말고 아무 데도 접속하지 않아요.`}</div>
      </div>

      <div className="footnote" style={{ textAlign: "center", margin: "24px 0 0" }}>
        ChoiManga {version}
      </div>
    </div>
  );
}
