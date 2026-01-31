const audioWorkletJS = `
class MyAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const queue = this.queue = [];
    this.pos = 0;
    this.port.onmessage = e=>{
        queue.push(e.data);
    }
  }
  process(inputs, outputs, parameters) {
    const output=outputs[0], n=output[0].length;
    let src = this.queue.length ? this.queue[0] : null;
    if (!src)
      return true;
    let pos = this.pos;
    for (let i=0; i<n && src; ++i) {
        output[0][i] = src[pos];
        output[1][i] = src[pos+1];
        pos += 2;
        if (src.length <= pos) {
            this.queue.shift();
            this.port.postMessage(this.queue.length);
            src = this.queue.length ? this.queue[0] : null;
            pos = 0;
        }
    }
    this.pos = pos;
    return true;
  }
};
registerProcessor("worklet-processor", MyAudioProcessor);
`;

class AudioSystem {
    constructor(gl, fps=60) {
        this.gl = gl;
        this.fps = fps;
        this.audioQueueLen = 0;
        this.context = null;
        const maxSR = 48000;
        this.audioFB = twgl.createFramebufferInfo(this.gl,
            [{internalFormat: gl.RG32F, minMag: gl.LINEAR}], maxSR/fps, 1);
        this.audioFB.cpu = new Float32Array(this.audioFB.width*2); 
        this.audioContext = null;
        this.playing = false;
    }
    get sampleRate() {
        return this.audioContext.sampleRate;
    }
    get samplesPerFrame() {
        return this.sampleRate / this.fps;
    }
    async toggle() {
        if (!this.audioContext) {
            this.audioContext = new AudioContext();
            const workletURL = URL.createObjectURL(
                new Blob([audioWorkletJS], {type: 'application/javascript'}));
            await this.audioContext.audioWorklet.addModule(workletURL);
            this.workletNode = new AudioWorkletNode(
                this.audioContext, 'worklet-processor',{outputChannelCount:[2]});
            this.workletNode.connect(this.audioContext.destination);
            this.workletNode.port.onmessage = e=>{
                this.audioQueueLen -= 1;
                if (e.data==0) {
                    console.log('empty');
                }
            };
        }
        this.playing = !this.playing;
    }

    push() {
        const n = 2 * this.samplesPerFrame;
        this.workletNode.port.postMessage(this.audioFB.cpu.subarray(0, n));
        this.audioQueueLen += 1;
    }
};