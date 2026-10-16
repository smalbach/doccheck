import { useEffect, useState } from 'react';

export type CameraProblem = 'insecure' | 'unsupported' | 'denied' | 'notFound' | 'failed';

function problemOf(error: unknown): CameraProblem {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'notFound';
  return 'failed';
}

const stopTracks = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop());

/** The back camera while mounted; its tracks stop on unmount, so the camera light goes off with the dialog. */
export function useCamera() {
  const unavailable: CameraProblem | undefined = !window.isSecureContext ? 'insecure' : !navigator.mediaDevices?.getUserMedia ? 'unsupported' : undefined;
  const [stream, setStream] = useState<MediaStream>();
  const [problem, setProblem] = useState<CameraProblem>();

  useEffect(() => {
    if (unavailable) return;
    let active = true;
    let current: MediaStream | undefined;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(
      (s) => {
        if (!active) return stopTracks(s);
        current = s;
        setStream(s);
      },
      (e: unknown) => active && setProblem(problemOf(e)),
    );
    return () => {
      active = false;
      if (current) stopTracks(current);
    };
  }, [unavailable]);

  return { stream, problem: unavailable ?? problem };
}
