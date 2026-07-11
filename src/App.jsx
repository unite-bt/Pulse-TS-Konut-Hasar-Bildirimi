import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cx from "clsx";
import { useConversation } from "@elevenlabs/react";
import "./App.css";
import MicrofonIcon from "../public/app-icons/Microfon";

const USER_SPEAKING_VAD_THRESHOLD = 0.35;
const USER_SPEAKING_VOLUME_THRESHOLD = 0.02;
const CONNECTION = "webrtc";

const normalizeTheme = (theme) =>
  String(theme || "").toLowerCase() === "dark" ? "dark" : "light";

const getThemeFromUrl = () =>
  new URLSearchParams(window.location.search).get("theme") || "";

const RN_END_CALL_EVENT = Object.freeze({
  type: "end-call",
  eventType: "end_call",
});
const buildExceptionEvent = (errorMessage) => ({
  type: "end-call",
  eventType: "exception",
  error:
    typeof errorMessage === "string" && errorMessage
      ? errorMessage
      : "Beklenmeyen bir hata oluştu.",
});

const parseError = (error) => {
  if (!error) return "Beklenmeyen bir hata oluştu.";
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object") {
    if (typeof error.message === "string") return error.message;
    if (error.error_event && typeof error.error_event.message === "string") {
      return error.error_event.message;
    }
  }
  return "Beklenmeyen bir hata oluştu.";
};

function App() {
  // const agentId = import.meta.env.VITE_UNITE_NOT_REPAIRED_AGENT_ID; // import.meta.env.VITE_UNITE_AGENT_ID;
  const isDevEnv = import.meta.env.VITE_DEV_ENV === "DEV"; // import.meta.env.VITE_DEV_ENV === "DEV";

  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(isDevEnv ? "ok" : "");
  const [isStarting, setIsStarting] = useState(false);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);
  const lastRedirectHandledRef = useRef({ time: 0, suppressUntil: 0 });
  const lastEndEventRef = useRef(0);
  const endSessionRef = useRef(async () => {});
  const lastStatusMessageRef = useRef("Başlatılıyor");
  const [isFetchingSignedUrl, setIsFetchingSignedUrl] = useState(false);
  const [agentId, setAgentId] = useState(
    import.meta.env.VITE_UNITE_DEFAULT_AGENT_ID,
  );
  const [userData, setUserData] = useState({});
  const [payloadTheme, setPayloadTheme] = useState("");
  console.log("*** user data: ", userData);
  const initialTheme = useMemo(
    () => getThemeFromUrl() || document.documentElement.dataset.theme || "",
    [],
  );
  const theme = useMemo(
    () => normalizeTheme(payloadTheme || initialTheme),
    [payloadTheme, initialTheme],
  );
  const [hasRnPayload, setHasRnPayload] = useState(isDevEnv);
  const [isAccessDetermined, setIsAccessDetermined] = useState(isDevEnv);
  const [hasSessionEnded, setHasSessionEnded] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const userSpeakingTimeoutRef = useRef(null);
  const userSpeakingAnimationFrameRef = useRef(null);
  const [hasPendingAgentSpeech, setHasPendingAgentSpeech] = useState(true);

  const clearUserSpeakingTimeout = useCallback(() => {
    if (userSpeakingTimeoutRef.current) {
      clearTimeout(userSpeakingTimeoutRef.current);
      userSpeakingTimeoutRef.current = null;
    }
  }, []);

  const scheduleUserSpeakingTimeout = useCallback(() => {
    clearUserSpeakingTimeout();
    userSpeakingTimeoutRef.current = setTimeout(() => {
      setIsUserSpeaking(false);
      userSpeakingTimeoutRef.current = null;
    }, 1200);
  }, [clearUserSpeakingTimeout]);

  const triggerUserSpeaking = useCallback(() => {
    setIsUserSpeaking(true);
    scheduleUserSpeakingTimeout();
  }, [scheduleUserSpeakingTimeout]);

  const audioContext = useMemo(() => {
    try {
      return new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.dataset.theme = "dark";
      return;
    }

    delete document.documentElement.dataset.theme;
  }, [theme]);

  useEffect(() => {
    const handleDataFromRN = (event) => {
      const data = event.detail;
      const expectedToken = import.meta.env.VITE_ALLOWED_TOKEN;

      setPayloadTheme(data?.theme || data?.user?.theme || "");

      if (!data?.token) {
        setAllowed("yetkisiz erisim");
        setHasRnPayload(false);
        setIsAccessDetermined(true);
        return;
      } else if (data?.token !== expectedToken) {
        setAllowed("yetkisiz erisim");
        setHasRnPayload(false);
        setIsAccessDetermined(true);
        return;
      } else {
        setAllowed("ok");
        setHasRnPayload(true);
        setIsAccessDetermined(true);
      }

      console.log("*** gelen data: ", data);
      setUserData(data);
    };

    window.addEventListener("fromReactNative", handleDataFromRN);
    return () =>
      window.removeEventListener("fromReactNative", handleDataFromRN);
  }, []);

  const iframeParentOrigin = useMemo(
    () => import.meta.env.VITE_IFRAME_PARENT_ORIGIN || "*",
    [],
  );

  const redirectToCancelPage = useCallback(
    async (navigationObj) => {
      const detail = {
        type: "newForm",
        ...navigationObj,
      };
      const navigationEvent = new CustomEvent("newForm", { detail });
      window.dispatchEvent(navigationEvent);

      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          { type: "newForm", data: detail },
          iframeParentOrigin,
        );
      }

      setIsStarting(false);
      await endSessionRef.current();
      return "navigation-event-dispatched";
    },
    [iframeParentOrigin],
  );

  const shouldSuppressAgentMessage = useCallback(() => {
    return Date.now() < lastRedirectHandledRef.current.suppressUntil;
  }, []);

  const dispatchEndCallEvent = useCallback(
    (payload = RN_END_CALL_EVENT) => {
      const now = Date.now();
      if (now - lastEndEventRef.current < 500) return "end-call-suppressed";
      lastEndEventRef.current = now;

      const endCallEvent = new CustomEvent("end-call", { detail: payload });
      window.dispatchEvent(endCallEvent);

      if (window.ReactNativeWebView?.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, iframeParentOrigin);
      }
      return "end-call-dispatched";
    },
    [iframeParentOrigin],
  );

  const obtainSignedUrl = useCallback(
    async (isDamageFixed, targetAgentId) => {
      const resolvedAgentId = targetAgentId || agentId;
      if (!resolvedAgentId) {
        setError("UNITE_AGENT_ID ortam değişkenini tanımlayın.");
        return null;
      }
      // if (isDevEnv) {
      //   setError("VITE_UNITE_API_KEY ortam değişkenini tanımlayın.");
      //   return null;
      // }
      if (isFetchingSignedUrl) return null;

      setIsFetchingSignedUrl(true);
      try {
        if (isDevEnv) {
          console.log("*** run: ", isDamageFixed);
          const url = `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${resolvedAgentId}&connection=${CONNECTION}`;
          const response = await fetch(url, {
            headers: {
              "xi-api-key": import.meta.env.VITE_UNITE_API_KEY,
            },
          });
          if (!response.ok) {
            const details = await response.text();
            console.error("DEV signed URL error body:", details);
            throw new Error(
              `Signed URL isteği başarısız oldu. Detay: ${
                details || response.status
              }`,
            );
          }
          const data = await response.json();
          const signed = data?.token || data?.token; // tolerate both
          if (!signed)
            throw new Error(
              "Signed URL yanıtı geçersiz (signed_url/signedUrl yok).",
            );
          return signed;
        } else {
          console.log("*** else");
          const url = `/tskonutihbariagent/api/signed-url?token=${
            import.meta.env.VITE_ALLOWED_TOKEN
          }&isDamageFixed=${isDamageFixed}&connection=${CONNECTION}`;
          const response = await fetch(url, {
            headers: { Accept: "application/json" },
          });

          if (!response.ok) {
            const details = await response.text();
            console.error("PROD signed URL error body:", details);
            throw new Error(
              `Signed URL isteği başarısız oldu. Durum kodu: ${response.status}`,
            );
          }

          const data = await response.json();
          console.log("*** response: ", data);
          const signed = data?.token || data?.token; // tolerate both
          if (!signed)
            throw new Error(
              "Signed URL yanıtı geçersiz (signedUrl/signed_url yok).",
            );
          setError("");
          return signed;
        }
      } catch (fetchError) {
        setError(parseError(fetchError));
        throw fetchError;
      } finally {
        setIsFetchingSignedUrl(false);
      }
    },
    [agentId, isDevEnv, isFetchingSignedUrl],
  );

  const handleRedirectTool = useCallback(
    async (navigationObj) => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const now = Date.now();
      lastRedirectHandledRef.current = { time: now, suppressUntil: now + 5000 };
      return await redirectToCancelPage(navigationObj);
    },
    [redirectToCancelPage],
  );

  const clientTools = useMemo(
    () => ({
      ts_konut_hasar_bildirimi_client_tool_dev: async (props) => {
        console.log("*** props: ", props);
        try {
          const payload = {
            damageDate: props?.damageDate || null,
            damageTime: props?.damageTime || null,
            price: props?.price || null,
            totalPrice: props?.totalPrice || null,
            damageCause:
              typeof props?.damageCause === "string"
                ? JSON.parse(props?.damageCause)
                : props?.damageCause || null,
            city: props?.cityid,
            town: props?.townid,
            // elabs tarafından gelen ama ts tarafına şimdilik gönderilmeyen iki parametre
            // cityName: props?.cityname || null,
            // townName: props?.townname || null,
            description: props?.description || null,
          };
          const result = await handleRedirectTool(payload);
          return { ok: true, result };
        } catch (toolError) {
          const msg = parseError(toolError);
          dispatchEndCallEvent(buildExceptionEvent(msg));
          return { ok: false, error: msg };
        }
      },

      ts_konut_hasar_bildirimi_client_tool_onarildi_dev: async (props) => {
        console.log("*** props: ", props);
        try {
          const payload = {
            damageDate: props?.damageDate || null,
            damageTime: props?.damageTime || null,
            totalPrice: props?.totalPrice || null,
            damageReason:
              typeof props?.damageReason === "string"
                ? JSON.parse(props?.damageReason)
                : props?.damageReason || null,
            description: props?.description || null,
          };
          const result = await handleRedirectTool(payload);
          return { ok: true, result };
        } catch (toolError) {
          const msg = parseError(toolError);
          dispatchEndCallEvent(buildExceptionEvent(msg));
          return { ok: false, error: msg };
        }
      },

      ts_konut_hasar_bildirimi_client_tool_onarilmadi_dev: async (props) => {
        console.log("*** props: ", props);
        try {
          const payload = {
            damageDate: props?.damageDate || null,
            damageTime: props?.damageTime || null,
            totalPrice: props?.totalPrice || null,
            damageReason:
              typeof props?.damageReason === "string"
                ? JSON.parse(props?.damageReason)
                : props?.damageReason || null,
            description: props?.description || null,
          };
          const result = await handleRedirectTool(payload);
          return { ok: true, result };
        } catch (toolError) {
          const msg = parseError(toolError);
          dispatchEndCallEvent(buildExceptionEvent(msg));
          return { ok: false, error: msg };
        }
      },
    }),
    [handleRedirectTool, dispatchEndCallEvent],
  );

  const handleIncomingEvent = useCallback(
    (event) => {
      if (
        event?.type === "tentative_user_transcript" ||
        event?.type === "user_transcript"
      ) {
        triggerUserSpeaking();
      }
      if (!event) return;

      if (typeof event === "object" && "source" in event) {
        if (event.source === "user") triggerUserSpeaking();
        if (event.source === "ai") {
          setHasPendingAgentSpeech(true);
          if (shouldSuppressAgentMessage()) return;
        }
        return;
      }
      if (!event.type) return;

      if (event.type === "agent_response" && event.agent_response_event) {
        setHasPendingAgentSpeech(true);
        if (shouldSuppressAgentMessage()) return;
        return;
      }
      if (
        event.type === "agent_response_correction" &&
        event.agent_response_correction_event
      ) {
        setHasPendingAgentSpeech(true);
        if (shouldSuppressAgentMessage()) return;
      }
    },
    [shouldSuppressAgentMessage, triggerUserSpeaking],
  );

  const handleStatusChange = useCallback(
    ({ status }) => {
      if (status === "connected") {
        setError("");
        setIsStarting(false);
        setHasSessionEnded(false);
      }
      if (status === "disconnected") {
        setIsStarting(false);
        dispatchEndCallEvent();
      }
    },
    [dispatchEndCallEvent],
  );

  useEffect(() => {
    const isEmbedded = window.self !== window.top;
    if (!isEmbedded) return undefined;

    document.body.classList.add("embedded-chat");
    const sendHeight = () => {
      const height = document.documentElement.scrollHeight;
      window.parent.postMessage(
        { type: "chat-iframe-size", height },
        iframeParentOrigin,
      );
    };

    sendHeight();
    const observer = new MutationObserver(sendHeight);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    window.addEventListener("resize", sendHeight);

    return () => {
      document.body.classList.remove("embedded-chat");
      observer.disconnect();
      window.removeEventListener("resize", sendHeight);
    };
  }, [iframeParentOrigin]);

  const { startSession, endSession, status, isSpeaking, getInputVolume } =
    useConversation({
      agentId,
      connectionType: "webrtc",
      clientTools,
      overrides: {
        conversation: {
          text_only: false,
          client_events: [
            "audio",
            "agent_response",
            "agent_response_correction",
            "user_transcript",
            "tentative_user_transcript",
            "vad_score",
            "internal_tentative_agent_response",
          ],
        },
        audio: {
          context: audioContext,
        },
      },
      onMessage: handleIncomingEvent,
      onVadScore: ({ vadScore }) => {
        if (vadScore > USER_SPEAKING_VAD_THRESHOLD) triggerUserSpeaking();
      },
      onError: (incomingError) => {
        const msg = parseError(incomingError);
        setError(msg);
        setIsStarting(false);
        dispatchEndCallEvent(buildExceptionEvent(msg));
      },
      onStatusChange: handleStatusChange,
    });

  useEffect(() => {
    endSessionRef.current = async () => {
      try {
        await endSession();
      } catch (stopError) {
        console.error("endSession error:", stopError);
      }
    };
  }, [endSession]);

  useEffect(() => {
    return () => {
      clearUserSpeakingTimeout();
      if (userSpeakingAnimationFrameRef.current) {
        cancelAnimationFrame(userSpeakingAnimationFrameRef.current);
        userSpeakingAnimationFrameRef.current = null;
      }
    };
  }, [clearUserSpeakingTimeout]);

  useEffect(() => {
    if (!isSpeaking) setHasPendingAgentSpeech(false);
  }, [isSpeaking]);

  const agentConfigured = useMemo(() => Boolean(agentId), [agentId]);
  const micIsMuted = false;
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  const activityState = isSpeaking
    ? "speaking"
    : isConnected
      ? micIsMuted
        ? "muted"
        : "listening"
      : "idle";
  const isRingActive = isSpeaking || isUserSpeaking;

  const statusMessageBase = useMemo(() => {
    if (!isConnected) return "Başlatılıyor";
    if (isSpeaking || hasPendingAgentSpeech) return "Konuşuyor";
    return "Sizi dinliyorum";
  }, [hasPendingAgentSpeech, isConnected, isSpeaking]);

  useEffect(() => {
    if (!hasSessionEnded) lastStatusMessageRef.current = statusMessageBase;
  }, [hasSessionEnded, statusMessageBase]);

  useEffect(() => {
    if (!isConnected || typeof getInputVolume !== "function") return undefined;

    const pollVolume = () => {
      const volume = getInputVolume();
      if (
        typeof volume === "number" &&
        volume > USER_SPEAKING_VOLUME_THRESHOLD
      ) {
        triggerUserSpeaking();
      }
      userSpeakingAnimationFrameRef.current = requestAnimationFrame(pollVolume);
    };

    userSpeakingAnimationFrameRef.current = requestAnimationFrame(pollVolume);
    return () => {
      if (userSpeakingAnimationFrameRef.current) {
        cancelAnimationFrame(userSpeakingAnimationFrameRef.current);
        userSpeakingAnimationFrameRef.current = null;
      }
    };
  }, [getInputVolume, isConnected, triggerUserSpeaking]);

  const statusMessage = hasSessionEnded
    ? lastStatusMessageRef.current
    : statusMessageBase;
  const shouldShowShell =
    isAccessDetermined && allowed === "ok" && hasRnPayload;
  const shouldShowUnauthorized = isAccessDetermined && allowed !== "ok";

  const handleStart = useCallback(async () => {
    if (!agentConfigured) {
      setError("UNITE_AGENT_ID ortam değişkenini tanımlayın.");
      return;
    }

    setError("");
    setIsStarting(true);
    setHasSessionEnded(false);

    try {
      const payload = userData;
      const derivedAgentId =
        payload?.isDamageFixed === true
          ? import.meta.env.VITE_UNITE_REPAIRED_AGENT_ID
          : payload?.isDamageFixed === false
            ? import.meta.env.VITE_UNITE_NOT_REPAIRED_AGENT_ID
            : import.meta.env.VITE_UNITE_DEFAULT_AGENT_ID;
      setAgentId(derivedAgentId);
      const freshSignedUrl = await obtainSignedUrl(payload?.isDamageFixed, derivedAgentId);
      if (!freshSignedUrl) {
        setIsStarting(false);
        return;
      }

      await startSession({
        // signedUrl: freshSignedUrl, // <-- ÖNEMLİ: yalnızca signedUrl gönder
        conversationToken: freshSignedUrl,
        connectionType: "webrtc",
        dynamicVariables: {
          user_name: payload?.user?.name || "",
          damageReason: JSON.stringify(payload?.damageReason) || "",
        },
      });
    } catch (startError) {
      const msg = parseError(startError);
      setError(msg);
      setIsStarting(false);
      dispatchEndCallEvent(buildExceptionEvent(msg));
    }
  }, [
    agentConfigured,
    obtainSignedUrl,
    startSession,
    dispatchEndCallEvent,
    userData,
  ]);

  const handleStop = useCallback(async () => {
    setIsStarting(false);
    setHasSessionEnded(true);
    await endSession();
    dispatchEndCallEvent();
  }, [dispatchEndCallEvent, endSession]);

  const handleSessionButton = useCallback(() => {
    if (isConnected || isConnecting || isStarting) return handleStop();
    return handleStart();
  }, [handleStart, handleStop, isConnected, isConnecting, isStarting]);

  useEffect(() => {
    const handleAppBackground = () => {
      if (isConnected || isConnecting || isStarting) handleStop();
    };
    window.addEventListener("app-background", handleAppBackground);
    return () =>
      window.removeEventListener("app-background", handleAppBackground);
  }, [handleStop, isConnected, isConnecting, isStarting]);

  useEffect(() => {
    if (allowed !== "ok") return;
    if (!hasRnPayload) return;
    if (hasAutoStarted) return;
    if (!agentConfigured || isConnected || isConnecting || isStarting) return;

    setHasAutoStarted(true);
    handleStart();
  }, [
    allowed,
    agentConfigured,
    hasAutoStarted,
    hasRnPayload,
    isConnected,
    isConnecting,
    isStarting,
    handleStart,
  ]);

  const sessionButtonLabel =
    hasSessionEnded || isConnected || isConnecting || isStarting
      ? "Görüşmeyi Sonlandır"
      : "Devam Et";

  const sessionButtonDisabled =
    isFetchingSignedUrl || (!isConnected && !agentConfigured);

  const shellContent = (
    <div className="assistant-shell">
      <div className="assistant-shell__grabber" aria-hidden="true" />
      <div className="assistant-shell__body">
        <div className="assistant-shell__visual">
          <div
            className={cx("voice-visual", activityState, {
              "ring-active": isRingActive,
              "ring-agent": isSpeaking,
              "ring-user": isUserSpeaking,
            })}
          >
            <div className="voice-mic">
              <MicrofonIcon />
            </div>
            <span className="voice-ring-primary" aria-hidden="true" />
            <span className="voice-ring-secondary" aria-hidden="true" />
            <span className="voice-ring-tertiary" aria-hidden="true" />
          </div>
          <div className="assistant-shell__status" aria-live="polite">
            {statusMessage}
          </div>
        </div>
      </div>
      <div className="voice-action-wrapper">
        <button
          type="button"
          className={cx("voice-action", isConnected ? "end" : "start")}
          disabled={sessionButtonDisabled}
          onClick={handleSessionButton}
        >
          {sessionButtonLabel}
        </button>
      </div>
    </div>
  );

  if (!shouldShowShell && !shouldShowUnauthorized) return null;

  return (
    <div className={cx("app", `app--theme-${theme}`)}>
      {shouldShowShell && (
        <div className="app__background" aria-hidden="true"></div>
      )}
      <div className="app__foreground">
        {shouldShowShell ? (
          shellContent
        ) : (
          <div
            style={{
              display: "flex",
              height: "100vh",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              flexDirection: "column",
            }}
          >
            <h2>🚫 {allowed || "yetkisiz erisim"}</h2>
            <p>Bu sayfaya erişim izniniz yok.</p>
          </div>
        )}
      </div>
      {shouldShowShell && error && <div className="error-banner">{error}</div>}
    </div>
  );
}

export default App;
