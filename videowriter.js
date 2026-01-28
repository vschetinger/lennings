class VideoWriter {
    constructor(suggestedName, width=1920, height=1080, fps=60) {
        this.suggestedName = suggestedName;
        this.width = width;
        this.height = height;
        this.fps = fps;
        this.frameCount = 0;
        this.fb = twgl.createFramebufferInfo(gl, null, width, height);
        this.fb.cpu = new Uint8ClampedArray(width*height*4);
        this.sampleRate = 48000;
        this.audioBufSize = this.sampleRate / fps
        this.audioFB = twgl.createFramebufferInfo(gl, [{internalFormat: gl.RG32F}], this.audioBufSize, 1);
        this.audioFB.cpu = new Float32Array(this.audioBufSize*2);
    }

    async start() {
        const handle = await window.showSaveFilePicker({
          startIn: 'videos',
          suggestedName: this.suggestedName+'.webm',
          types: [{
            description: 'Video File',
            accept: {'video/webm' :['.webm']}
            }],
        });
        this.name = await handle.name.split('.')[0];
        const audioHandle = await window.showSaveFilePicker({
          startIn: 'videos',
          suggestedName: this.name+'.audio',
          types: [{
            description: 'Raw File',
            accept: {'video/webm' :['.audio']}
            }],
        });
        this.fileWritableStream = await handle.createWritable();
        this.audioStream = await audioHandle.createWritable();
        const webmWriter = this.webmWriter = new WebMWriter({
            fileWriter: this.fileWritableStream,
            codec: 'AV1',
            width: this.width,
            height: this.height});
        this.encoder = new VideoEncoder({
            output: chunk=>webmWriter.addFrame(chunk),
            error: console.log,
        });
        this.encoder.configure({
            codec: "av01.0.01M.08",
            //codec: "vp09.00.10.08",
            //codec: "vp8",
            width:this.width, height:this.height,
            bitrate: 12_000_000,
            framerate: this.fps,
        });
    }

    async frame() {
        const {width, height, fb, audioFB} = this;
        twgl.bindFramebufferInfo(gl, fb);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, fb.cpu);
        twgl.bindFramebufferInfo(gl, audioFB);
        gl.readPixels(0, 0, this.audioBufSize, 1, gl.RG, gl.FLOAT, audioFB.cpu);
        const frame = new VideoFrame(fb.cpu, {timestamp: this.frameCount*1e6/this.fps,
            codedWidth: width, codedHeight: height, format: 'RGBA'});
        
        if (this.encoder) {
            this.encoder.encode(frame, { keyFrame: this.frameCount%this.fps==0 });
            await this.audioStream.write(audioFB.cpu);
        }
        frame.close();
        
        this.frameCount += 1;
    }
    async close() {
        await this.encoder.flush();
        this.encoder.close();
        await this.webmWriter.complete();
        await this.fileWritableStream.close();
        await this.audioStream.close();
        const name = this.name;
        console.log(`ffmpeg -y -i ${name}.webm -f f32le -ac 2 -ar ${this.sampleRate} -i ${name}.audio -crf 12 -c:a aac ${name}.mp4`)
    }
};
