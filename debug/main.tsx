import Peer from "skyway-js";
import React, { FC, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { getAudioStream } from "./util";
import { SkyWayRED } from "../src";

const peer = new Peer({
  key: (window as any).__SKYWAY_KEY__,
  config: {
    //@ts-ignore
    encodedInsertableStreams: true,
  },
});
const skywayRED = new SkyWayRED({ redDistance: 0 });

const App: FC = () => {
  const [peerId, setPeerId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [file, setFile] = useState<File>();
  const remoteRef = useRef<HTMLAudioElement>();

  useEffect(() => {
    peer.on("open", (peerId) => {
      setPeerId(peerId);
    });
    peer.on("call", (connection) => {
      connection.answer();
      skywayRED.activateRED(connection);

      connection.on("stream", (stream) => {
        skywayRED.setupReceiver(connection);
        remoteRef.current.srcObject = stream;
      });
    });
  }, []);

  const call = async () => {
    const { stream } = await getAudioStream(await file.arrayBuffer(), 1);

    const connection = peer.call(targetId, stream, {
      audioReceiveEnabled: false,
    });
    skywayRED.activateRED(connection);
  };

  return (
    <div>
      <div>
        <div>{peerId}</div>
        <input
          onChange={(e) => setTargetId(e.target.value)}
          value={targetId}
          placeholder="target peerId"
        />
        <input type="file" onChange={(e) => setFile(e.target.files[0])} />
        <button onClick={call}>call</button>
      </div>
      <div>
        <audio autoPlay controls ref={remoteRef} />
      </div>
    </div>
  );
};

ReactDOM.render(<App />, document.getElementById("root"));
