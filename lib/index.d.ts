import { MediaConnection } from "skyway-js";
export declare class SkyWayRED {
    private options;
    private redSender;
    remoteRedDistance: number;
    readonly redDistance: number;
    readonly useAdaptiveRedDistance: boolean;
    constructor(options?: Partial<{
        redDistance: number;
        useAdaptiveRedDistance: boolean;
    }>);
    private getRTCPeerConnection;
    activateRED(connection: MediaConnection): void;
    private senderTransform;
    setupReceiver(connection: any): void;
}
