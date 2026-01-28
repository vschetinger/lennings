class PNGView extends DataView {

	constructor(buffer, byteOffset, byteLength, bits_per_channel = 2, skip_alpha = true) {
		super(buffer, byteOffset, byteLength);
		this.bits_per_channel = bits_per_channel;
		this.skip_alpha = skip_alpha;
		this.tempBuffer = new DataView(new ArrayBuffer(4));
	};

	get byteLength() {
		return Math.floor(((super.byteLength * this.bits_per_channel * (this.skip_alpha ? 3 : 4)) / 4) / 8);
	}

	_imIdx(byteOffset){
		return [Math.floor(byteOffset * 8 / this.bits_per_channel), (byteOffset * 8) % this.bits_per_channel]
	}

	rwBits(byteOffset, numBits, write = true){

		if (!write) this.tempBuffer = new DataView(new ArrayBuffer(4));

		let [baseImByteIdx, imBitIdx] = this._imIdx(byteOffset) // imBitIdx is current bit index into image byte,
		let imByteIdx = Math.floor(baseImByteIdx * (this.skip_alpha ? 4 : 3) / 3);
		let valBitIdx = 0; 
		let tempBufferIdx = 0; 

		let numBitsToWrite = 0;
		let maskIntoIm = 0;
		let valPiece = 0;

		while (valBitIdx < numBits) { // assumes numBits is a multiple of 8...
			numBitsToWrite = Math.min(this.bits_per_channel - (imBitIdx % this.bits_per_channel), 8 - (valBitIdx % 8)) 
			maskIntoIm = ~(~0 << numBitsToWrite) << (imBitIdx % this.bits_per_channel)
			if (write) {
				valPiece = this.tempBuffer.getUint8(tempBufferIdx) >>> (valBitIdx % 8) << (imBitIdx % this.bits_per_channel)
				super.setUint8(imByteIdx, (super.getUint8(imByteIdx) & ~maskIntoIm | valPiece & maskIntoIm))
			} else {
				valPiece = (super.getUint8(imByteIdx) & maskIntoIm) >>> (imBitIdx % this.bits_per_channel) << (valBitIdx % 8); 
				this.tempBuffer.setUint8(tempBufferIdx, this.tempBuffer.getUint8(tempBufferIdx) | valPiece);
			}

			// update indices
			valBitIdx += numBitsToWrite
			imBitIdx += numBitsToWrite
			imByteIdx = Math.floor((Math.floor(imBitIdx / this.bits_per_channel) + baseImByteIdx) * (this.skip_alpha ? 4 : 3) / 3);
			tempBufferIdx = Math.floor(valBitIdx / 8)
		}

		return this.tempBuffer;

	}


	setUint8(byteOffset, value){ 
		this.tempBuffer.setUint8(0, value); 
		return this.rwBits(byteOffset, 8, true); 
	}

	getUint8(byteOffset){ return this.rwBits(byteOffset, 8, false).getUint8(0) }

	setUint16(byteOffset, value, littleEndian){ 
		this.tempBuffer.setUint16(0, value, littleEndian);
		return this.rwBits(byteOffset, 16, true) 
	}

	getUint16(byteOffset, littleEndian){ return this.rwBits(byteOffset, 16, false).getUint16(0, littleEndian) }

	setUint32(byteOffset, value, littleEndian){ 
		this.tempBuffer.setUint32(0, value, littleEndian);
		return this.rwBits(byteOffset, 32, true) 
	}

	getUint32(byteOffset, littleEndian){ return this.rwBits(byteOffset, 32, false).getUint32(0, littleEndian) }

	setFloat32(byteOffset, value, littleEndian){ 
		this.tempBuffer.setFloat32(0, value, littleEndian);
		return this.rwBits(byteOffset, 32, true); 
	}

	getFloat32(byteOffset, littleEndian){ return this.rwBits(byteOffset, 32, false).getFloat32(0, littleEndian) }

}
