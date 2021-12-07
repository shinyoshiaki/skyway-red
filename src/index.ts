import { MediaConnection } from "skyway-js";
import { buffer2ArrayBuffer, Red, RedSender } from "werift-rtp";

export class SkyWayRED {
  private redSender: RedSender;
  lastReceivedRedPacket: Red;
  readonly redDistance = this.options.redDistance ?? 1;
  readonly useAdaptiveRedDistance = this.options.useAdaptiveRedDistance;

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
    const pc = this.getRTCPeerConnection(connection);
    const { codecs } = RTCRtpSender.getCapabilities("audio");
    pc.getTransceivers()
      .filter((t) => t.sender.track.kind === "audio")
      .map((transceiver) => {
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
          if (sender?.track?.kind === "audio") {
            const codec = sender
              .getParameters()
              .codecs.find((c) => c.mimeType.includes("red"));
            const [blockPT] = codec.sdpFmtpLine.split("/");
            this.redSender = new RedSender(Number(blockPT), this.redDistance);
            this.senderTransform(sender, this.redSender);
          } else {
            this.senderTransform(sender);
          }
        });
      }
    });

    if (this.useAdaptiveRedDistance) {
      pc.addEventListener("connectionstatechange", () => {
        if (pc.iceConnectionState === "disconnected") {
          if (this.redSender && this.redSender.distance < 4) {
            this.redSender.distance = 4;
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
            if (distance < this.redSender.distance) {
              await new Promise((r) => setTimeout(r, 500));
            }
            this.redSender.distance = distance;
            await new Promise((r) => setTimeout(r, 50));
          }
        }
      });
    }

    connection.on("stream", () => {
      this.setupReceiver(connection);
    });
  }

  private senderTransform(sender: RTCRtpSender, redSender?: RedSender) {
    //@ts-ignore
    const senderStreams = sender.createEncodedStreams();
    const readableStream = senderStreams.readable;
    const writableStream = senderStreams.writable;
    const transformStream = new TransformStream({
      transform: (encodedFrame, controller) => {
        if (sender.track.kind === "video") {
          controller.enqueue(encodedFrame);
          return;
        }

        const packet = Red.deSerialize(Buffer.from(encodedFrame.data));
        const newPayload = packet.payloads.at(-1);
        redSender.push({
          buffer: newPayload.bin,
          timestamp: encodedFrame.timestamp,
        });
        const red = redSender.build();
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
      const receiverStreams = receiver.createEncodedStreams();
      const readableStream = receiverStreams.readable;
      const writableStream = receiverStreams.writable;
      const transformStream = new TransformStream({
        transform: (encodedFrame, controller) => {
          if (
            encodedFrame.data.byteLength > 0 &&
            receiver.track.kind === "audio"
          ) {
            const red = Red.deSerialize(encodedFrame.data);
            this.lastReceivedRedPacket = red;
          }
          controller.enqueue(encodedFrame);
        },
      });
      readableStream.pipeThrough(transformStream).pipeTo(writableStream);
    });
  }
}
