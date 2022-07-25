import Peer from "skyway-js";
import { SkyWayRED } from "@shinyoshiaki/skyway-red";

(async function main() {
  const localVideo = document.getElementById(
    "js-local-stream"
  ) as HTMLVideoElement;
  const localId = document.getElementById("js-local-id");
  const callTrigger = document.getElementById("js-call-trigger");
  const closeTrigger = document.getElementById("js-close-trigger");
  const remoteVideo = document.getElementById(
    "js-remote-stream"
  ) as HTMLVideoElement;
  const remoteId = document.getElementById("js-remote-id") as HTMLInputElement;

  const localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true,
  });

  // Render local stream
  localVideo.muted = true;
  localVideo.srcObject = localStream;
  localVideo.playsInline = true;
  await localVideo.play().catch(console.error);

  const peer = ((window as any).peer = new Peer({
    key: (window as any).__SKYWAY_KEY__,
    config: {
      //@ts-ignore
      encodedInsertableStreams: true,
    },
    debug: 3,
  }));
  const skywayRED = new SkyWayRED({ useAdaptiveRedDistance: true });
  setInterval(() => {
    console.log(skywayRED._lastReceivedRedPacket);
  }, 1000);

  // Register caller handler
  callTrigger.addEventListener("click", () => {
    // Note that you need to ensure the peer has connected to signaling server
    // before using methods of peer instance.
    if (!peer.open) {
      return;
    }

    const mediaConnection = peer.call(remoteId.value, localStream);
    skywayRED.activateRED(mediaConnection);

    mediaConnection.on("stream", async (stream) => {
      // Render remote stream for caller
      remoteVideo.srcObject = stream;
      remoteVideo.playsInline = true;
      await remoteVideo.play().catch(console.error);
    });

    mediaConnection.once("close", () => {
      (remoteVideo.srcObject as MediaStream)
        .getTracks()
        .forEach((track) => track.stop());
      remoteVideo.srcObject = null;
    });

    closeTrigger.addEventListener("click", () => mediaConnection.close(true));
  });

  peer.once("open", (id) => (localId.textContent = id));

  // Register callee handler
  peer.on("call", (mediaConnection) => {
    mediaConnection.answer(localStream);
    skywayRED.activateRED(mediaConnection);

    mediaConnection.on("stream", async (stream) => {
      // Render remote stream for callee
      remoteVideo.srcObject = stream;
      remoteVideo.playsInline = true;
      await remoteVideo.play().catch(console.error);
    });

    mediaConnection.once("close", () => {
      (remoteVideo.srcObject as MediaStream)
        .getTracks()
        .forEach((track) => track.stop());
      remoteVideo.srcObject = null;
    });

    closeTrigger.addEventListener("click", () => mediaConnection.close(true));
  });

  peer.on("error", console.error);
})();
