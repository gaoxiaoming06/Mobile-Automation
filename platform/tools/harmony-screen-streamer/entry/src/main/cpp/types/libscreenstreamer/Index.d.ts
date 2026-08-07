declare const screenStreamer: {
  start(port?: number, width?: number, height?: number, fps?: number, bitrate?: number): boolean;
  stop(): boolean;
  isRunning(): boolean;
};

export default screenStreamer;
