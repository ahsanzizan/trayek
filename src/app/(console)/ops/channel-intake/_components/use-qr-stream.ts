"use client";

import { useEffect, useState } from "react";

import { api } from "~/trpc/react";
import { type QrStreamPayload } from "~/server/channels/qr-broker";

type QrStreamState = "connecting" | "ready" | "error";

const QR_EMPTY_TIMEOUT_MS = 20_000;

export function useQrStream(enabled: boolean) {
  const [qr, setQr] = useState<QrStreamPayload | null>(null);
  const [streamState, setStreamState] = useState<QrStreamState>("connecting");
  const [pageHidden, setPageHidden] = useState(false);

  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const connect = api.channel.connect.useMutation();

  // Ensure a ChannelConnection row exists so the worker picks the
  // organization up on its pairing scan and starts emitting a QR.
  useEffect(() => {
    if (!enabled || pageHidden) {
      return;
    }

    connect.mutate(undefined, {
      onError: () => setStreamState("error"),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pageHidden]);

  const sub = api.channel.qrStream.useSubscription(undefined, {
    enabled: enabled && !pageHidden,
  });

  useEffect(() => {
    if (!enabled) {
      setQr(null);
      setStreamState("connecting");
      return;
    }

    if (pageHidden) {
      return;
    }

    const data = sub.data as QrStreamPayload | null | undefined;

    if (data?.dataUrl) {
      setQr(data);
      setStreamState("ready");
      return;
    }

    if (sub.status === "error") {
      setStreamState("error");
      return;
    }

    if (sub.status === "pending") {
      setStreamState("connecting");
    }
  }, [enabled, pageHidden, sub.data, sub.status]);

  useEffect(() => {
    if (!enabled || qr || pageHidden) {
      return;
    }

    const timer = setTimeout(() => {
      setStreamState("error");
    }, QR_EMPTY_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [enabled, qr, pageHidden]);

  return { qr, streamState };
}
