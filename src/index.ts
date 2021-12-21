import { MediaConnection } from "skyway-js";
import { buffer2ArrayBuffer, Red, RedEncoder } from "werift-rtp";

export class SkyWayRED {
  readonly redDistance = this.options.redDistance ?? 1;
  private readonly encoder = new RedEncoder(this.redDistance);
  readonly useAdaptiveRedDistance = this.options.useAdaptiveRedDistance;

  _lastReceivedRedPacket: Red;

  constructor(
    private options: Partial<{
      redDistance: number;
      useAdaptiveRedDistance: boolean;
    }> = {}
  ) {}

  private getRTCPeerConnection(connection: MediaConnection) {
    if (connection.open) {
      return connection.getPeerConnection();
    } else {
      connection.open = true;
      const pc = connection.getPeerConnection();
      connection.open = false;
      return pc;
    }
  }

  activateRED(connection: MediaConnection) {
    if (!RTCRtpSender.getCapabilities) return;

    const pc = this.getRTCPeerConnection(connection);
    const { codecs } = RTCRtpSender.getCapabilities("audio");
    pc.getTransceivers()
      .filter((t) => t.sender.track.kind === "audio")
      .map((transceiver) => {
        //@ts-ignore
        if (!transceiver.setCodecPreferences) {
          return;
        }
        //@ts-ignore
        transceiver.setCodecPreferences([
          codecs.find((c) => c.mimeType.includes("red")),
          ...codecs,
        ]);
      });

    let negotiated = false;
    pc.addEventListener("connectionstatechange", () => {
      if (pc.iceConnectionState === "connected" && !negotiated) {
        negotiated = true;
        pc.getSenders().forEach((sender) => {
          //@ts-ignore
          if (!sender.createEncodedStreams) {
            return;
          }
          this.senderTransform(sender);
        });
      }
    });

    if (this.useAdaptiveRedDistance) {
      pc.addEventListener("connectionstatechange", () => {
        if (pc.iceConnectionState === "disconnected") {
          if (this.encoder && this.encoder.distance < 4) {
            this.encoder.distance = 4;
          }
        }
      });
      new Promise<void>(async () => {
        while (true) {
          const stats = await pc.getStats();
          const arr = [...(stats as any).values()];
          const remoteInbound = arr.find((a) =>
            a.id.includes("RTCRemoteInboundRtpAudioStream")
          );
          if (remoteInbound?.fractionLost) {
            const distance = Math.round(remoteInbound.fractionLost * 10);
            if (distance < this.encoder.distance) {
              await new Promise((r) => setTimeout(r, 500));
            }
            this.encoder.distance = distance;
            await new Promise((r) => setTimeout(r, 50));
          }
        }
      });
    }

    connection.on("stream", () => {
      this.setupReceiver(connection);
    });
  }

  private senderTransform(sender: RTCRtpSender) {
    const codec = sender.getParameters().codecs[0].mimeType;
    //@ts-ignore
    const senderStreams = sender.createEncodedStreams();

    const readableStream = senderStreams.readable;
    const writableStream = senderStreams.writable;
    const transformStream = new TransformStream({
      transform: (encodedFrame, controller) => {
        if (
          !codec.toLowerCase().includes("red") ||
          encodedFrame.data.byteLength === 0
        ) {
          controller.enqueue(encodedFrame);
          return;
        }

        const packet = Red.deSerialize(Buffer.from(encodedFrame.data));
        const newPayload = packet.blocks.at(-1);
        this.encoder.push({
          block: newPayload.block,
          blockPT: newPayload.blockPT,
          timestamp: encodedFrame.timestamp,
        });
        const red = this.encoder.build();
        encodedFrame.data = buffer2ArrayBuffer(red.serialize());
        controller.enqueue(encodedFrame);
      },
    });
    readableStream.pipeThrough(transformStream).pipeTo(writableStream);
  }

  private setupReceiver(connection: MediaConnection) {
    const pc = this.getRTCPeerConnection(connection);
    pc.getReceivers().forEach((receiver) => {
      //@ts-ignore
      if (!receiver.createEncodedStreams) {
        return;
      }
      //@ts-ignore
      const receiverStreams = receiver.createEncodedStreams();

      const readableStream = receiverStreams.readable;
      const writableStream = receiverStreams.writable;
      const transformStream = new TransformStream({
        transform: (encodedFrame, controller) => {
          if (
            encodedFrame.data.byteLength > 0 &&
            receiver.track.kind === "audio" &&
            receiver
              .getParameters()
              .codecs[0].mimeType.toLowerCase()
              .includes("red")
          ) {
            const red = Red.deSerialize(encodedFrame.data);
            this._lastReceivedRedPacket = red;
          }
          controller.enqueue(encodedFrame);
        },
      });
      readableStream.pipeThrough(transformStream).pipeTo(writableStream);
    });
  }
}
