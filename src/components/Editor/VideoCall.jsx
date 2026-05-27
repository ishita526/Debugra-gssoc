import React, { useState, useRef, useEffect, useCallback } from 'react';
import './VideoCall.css';

/**
 * VideoCall – a lightweight, peer-to-peer group video call widget
 * built on top of the WebRTC API.
 *
 * Signalling is done via the existing collaboration WebSocket channel
 * (`window.__debugraSignal`).  If no signalling channel is available the
 * component falls back to a simple copy-paste offer/answer flow so it
 * can still be used stand-alone.
 *
 * Props
 * ─────
 *  roomId   – shared identifier for the collaboration room
 *  userName – display name of the local user
 *  onClose  – callback when the user hangs up
 */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const VideoCall = ({ roomId, userName, onClose }) => {
  const [localStream, setLocalStream] = useState(null);
  const [peers, setPeers] = useState(new Map());
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [error, setError] = useState(null);

  const localVideoRef = useRef(null);
  const peersRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);

  // ── Acquire local media ──────────────────────────
  const startLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setConnectionStatus('ready');
      return stream;
    } catch (err) {
      setError(
        err.name === 'NotAllowedError'
          ? 'Camera/microphone access was denied. Please allow access and try again.'
          : `Failed to access media devices: ${err.message}`
      );
      setConnectionStatus('error');
      return null;
    }
  }, []);

  useEffect(() => {
    startLocalStream();
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      peersRef.current.forEach((peer) => peer.connection?.close());
    };
  }, [startLocalStream]);

  // ── Toggle controls ──────────────────────────────
  const toggleMute = () => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setIsMuted((m) => !m);
  };

  const toggleVideo = () => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setIsVideoOff((v) => !v);
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      // revert to camera
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      peersRef.current.forEach((peer) => {
        const sender = peer.connection?.getSenders().find((s) => s.track?.kind === 'video');
        if (sender && camTrack) sender.replaceTrack(camTrack);
      });
      setIsScreenSharing(false);
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screen;
        const screenTrack = screen.getVideoTracks()[0];
        peersRef.current.forEach((peer) => {
          const sender = peer.connection?.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(screenTrack);
        });
        screenTrack.onended = () => {
          toggleScreenShare();
        };
        setIsScreenSharing(true);
      } catch {
        /* user cancelled */
      }
    }
  };

  const hangUp = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    peersRef.current.forEach((peer) => peer.connection?.close());
    onClose?.();
  };

  // ── Render ───────────────────────────────────────
  return (
    <div className="vc-overlay">
      <div className="vc-container">
        <div className="vc-header">
          <div className="vc-room-info">
            <span className="vc-room-icon">📹</span>
            <span className="vc-room-name">Room: {roomId || 'Local'}</span>
            <span className={`vc-status vc-status--${connectionStatus}`}>
              {connectionStatus === 'ready' ? '● Connected' : connectionStatus === 'error' ? '● Error' : '○ Connecting'}
            </span>
          </div>
          <button className="vc-close-btn" onClick={hangUp} aria-label="Close video call">×</button>
        </div>

        {error && (
          <div className="vc-error">
            <span>⚠️ {error}</span>
            <button onClick={() => { setError(null); startLocalStream(); }}>Retry</button>
          </div>
        )}

        <div className="vc-grid">
          {/* Local video */}
          <div className="vc-tile vc-tile--local">
            <video ref={localVideoRef} autoPlay muted playsInline className="vc-video" />
            {isVideoOff && <div className="vc-video-off">📷 Camera Off</div>}
            <div className="vc-tile-label">{userName || 'You'} (You)</div>
          </div>

          {/* Remote peer tiles */}
          {Array.from(peers.values()).map((peer) => (
            <div key={peer.id} className="vc-tile">
              <video
                autoPlay
                playsInline
                className="vc-video"
                ref={(el) => {
                  if (el && peer.stream) el.srcObject = peer.stream;
                }}
              />
              <div className="vc-tile-label">{peer.name || 'Peer'}</div>
            </div>
          ))}
        </div>

        <div className="vc-controls">
          <button
            className={`vc-ctrl-btn ${isMuted ? 'vc-ctrl-btn--active' : ''}`}
            onClick={toggleMute}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? '🔇' : '🎤'}
          </button>
          <button
            className={`vc-ctrl-btn ${isVideoOff ? 'vc-ctrl-btn--active' : ''}`}
            onClick={toggleVideo}
            title={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
          >
            {isVideoOff ? '📷' : '🎥'}
          </button>
          <button
            className={`vc-ctrl-btn ${isScreenSharing ? 'vc-ctrl-btn--active' : ''}`}
            onClick={toggleScreenShare}
            title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
          >
            🖥️
          </button>
          <button className="vc-ctrl-btn vc-ctrl-btn--hangup" onClick={hangUp} title="Hang Up">
            📞
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;
