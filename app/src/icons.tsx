// 선으로 그린 SVG 아이콘(24px 격자). 글자 기호는 아이콘으로 쓰지 않는다.

import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Icon = {
  FileAdd: () => (
    <Svg>
      <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5Z" />
      <path d="M13.5 3.5v5h5" />
      <path d="M12 12v5M9.5 14.5h5" />
    </Svg>
  ),
  FolderAdd: () => (
    <Svg>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
      <path d="M12 10.5v5M9.5 13h5" />
    </Svg>
  ),
  Folder: () => (
    <Svg>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    </Svg>
  ),
  Settings: () => (
    <Svg>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Svg>
  ),
  Play: () => (
    <Svg>
      <path d="M8 5.5v13l10-6.5Z" />
    </Svg>
  ),
  Pause: () => (
    <Svg>
      <path d="M8.5 5.5v13M15.5 5.5v13" />
    </Svg>
  ),
  Check: () => (
    <Svg>
      <path d="M5 12.5 9.5 17 19 7.5" />
    </Svg>
  ),
  Alert: () => (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.3v.2" />
    </Svg>
  ),
  Image: () => (
    <Svg>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m20.5 16-5-5-8 8" />
    </Svg>
  ),
  Retry: () => (
    <Svg>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9" />
      <path d="M19.5 4.5V9H15" />
    </Svg>
  ),
  Trash: () => (
    <Svg>
      <path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7" />
    </Svg>
  ),
  Back: () => (
    <Svg>
      <path d="M14.5 6l-6 6 6 6" />
    </Svg>
  ),
  ChevronDown: () => (
    <Svg>
      <path d="M6.5 9.5 12 15l5.5-5.5" />
    </Svg>
  ),
  Pen: () => (
    <Svg>
      <path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10Z" />
      <path d="m13 7 4 4" />
    </Svg>
  ),
  Power: () => (
    <Svg>
      <path d="M12 3.5v8" />
      <path d="M7 6.5a7.5 7.5 0 1 0 10 0" />
    </Svg>
  ),
  Chip: () => (
    <Svg>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <path d="M9.5 3.5v2.5M14.5 3.5v2.5M9.5 18v2.5M14.5 18v2.5M3.5 9.5H6M3.5 14.5H6M18 9.5h2.5M18 14.5h2.5" />
    </Svg>
  ),
  Drop: () => (
    <Svg>
      <path d="M12 4v11" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M5 19.5h14" />
    </Svg>
  ),
};
