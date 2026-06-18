interface Window {
  electronAPI?: {
    onOpenClawMessage?: (callback: (message: string) => void) => void;
    onStockPush?: (callback: (message: { type: string; text: string; emotion?: string }) => void) => void;
  };
  writerInstance?: {
    type: (text: string) => void;
  };
  SpeechRecognition?: typeof window.SpeechRecognition;
  webkitSpeechRecognition?: typeof window.webkitSpeechRecognition;
}

declare type SpeechRecognition = any;
