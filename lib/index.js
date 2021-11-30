import { buffer2ArrayBuffer, Red, RedSender } from "werift-rtp";
function getRTCPeerConnection(connection) {
    connection.open = true;
    const pc = connection.getPeerConnection();
    connection.open = false;
    return pc;
}
export function activateRED(connection) {
    const pc = getRTCPeerConnection(connection);
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
                if (sender.track.kind === "audio") {
                    const codec = sender
                        .getParameters()
                        .codecs.find((c) => c.mimeType.includes("red"));
                    const [blockPT] = codec.sdpFmtpLine.split("/");
                    const redSender = new RedSender(Number(blockPT), 2);
                    senderTransform(sender, redSender);
                }
                else {
                    senderTransform(sender);
                }
            });
        }
    });
}
function senderTransform(sender, redSender) {
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
            const red = redSender.build().serialize();
            encodedFrame.data = buffer2ArrayBuffer(red);
            controller.enqueue(encodedFrame);
        },
    });
    readableStream.pipeThrough(transformStream).pipeTo(writableStream);
}
export function setupReceiver(connection) {
    const pc = getRTCPeerConnection(connection);
    pc.getReceivers().forEach((receiver) => {
        //@ts-ignore
        const receiverStreams = receiver.createEncodedStreams();
        const readableStream = receiverStreams.readable;
        const writableStream = receiverStreams.writable;
        const transformStream = new TransformStream({
            transform: (encodedFrame, controller) => {
                controller.enqueue(encodedFrame);
            },
        });
        readableStream.pipeThrough(transformStream).pipeTo(writableStream);
    });
}
