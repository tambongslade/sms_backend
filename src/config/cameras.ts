// The CCTV channels the Camera menu shows: the Dahua NVR at 192.168.88.7 (school LAN).
// The video itself never passes through this backend. go2rtc on the school server reads
// the NVR and nginx hands each viewer's stream over to it once /cameras/authorize says yes.
// Stream names here must match the ones in go2rtc.yaml (camN = low-res H.264 sub stream,
// camN_hd = full-res H.265 main stream).

export interface CameraChannel {
    channel: number;
    name: string;
}

// Rename a camera here; the order is the order of the grid.
export const CAMERAS: CameraChannel[] = Array.from({ length: 12 }, (_, i) => ({
    channel: i + 1,
    name: `Camera ${i + 1}`,
}));

export const streamName = (channel: number, hd = false) => `cam${channel}${hd ? '_hd' : ''}`;
