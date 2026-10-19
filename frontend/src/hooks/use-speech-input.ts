import { useEffect, useRef, useState } from 'react';

// Minimal typings for the Web Speech API (not in standard TS lib)
type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionInstance) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useSpeechInput({
  lang = 'hy-AM',
  onResult,
  onError,
}: {
  lang?: string;
  onResult: (transcript: string) => void;
  onError?: (error: string) => void;
}) {
  const [isSupported] = useState(() => getSpeechRecognitionCtor() !== null);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Keep latest callbacks without re-creating recognition
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  onResultRef.current = onResult;
  onErrorRef.current = onError;

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const stop = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  };

  const start = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.continuous = true;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript;
        }
      }
      if (transcript.trim()) {
        onResultRef.current(transcript.trim());
      }
    };
    recognition.onerror = (event: any) => {
      setIsRecording(false);
      onErrorRef.current?.(event?.error || 'unknown');
    };
    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const toggle = () => {
    if (isRecording) stop();
    else start();
  };

  return { isSupported, isRecording, toggle, stop };
}
