// version of the encoded data is a 8 bit incrementing int
// the encoding supports arbitrary numbers of nested floats, and variable length lists of floats.
// presumably this should be sufficient to implement multi-species creatures
// creature positions in webgl are highp precision -> assumption: we need at most 32 bits per coordinate. 
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function serialize(obj, struct_version, dv, max_size_bytes){
    let struct = VERSION_DATA_STRUCT[struct_version];
    if (!dv) {
        const arr = new ArrayBuffer(max_size_bytes);
        let dv = new DataView(arr);
    }
    // set magic bytes "LNIA" in big endian
    dv.setUint32(0, 0x4C4E4941);
    dv.setUint8(4, struct_version);
    convert(dv, obj, struct, 5, encode=true); 
    return dv.buffer;
}

function deserialize(dv){
    if (dv.getUint32(0) != 0x4C4E4941) throw "err_magic"
    struct_version = dv.getUint8(4); 
    struct = VERSION_DATA_STRUCT[struct_version];
    return convert(dv, {}, struct, 5, encode=false);
}

// swap between ArrayBuffer and JSON object, depending on `encode`
function convert(dv, obj, struct, byte_idx, encode=true){

    // leave nodes are strings in struct
    if (typeof(struct) === 'string' || struct instanceof String){
        switch (struct) {
            case 'f32':
                if (encode) return [dv.setFloat32(byte_idx, obj), byte_idx + 4];
                else return [dv.getFloat32(byte_idx), byte_idx + 4];
                break;
            case 'ui8':
                if (encode) return [dv.setUint8(byte_idx, obj), byte_idx + 1];
                else return [dv.getUint8(byte_idx), byte_idx + 1];
                break;
            case 'str':
                if (encode) {
                    obj = textEncoder.encode(obj);
                }
                [obj, byte_idx] = convert(dv, obj, ["ui8"], byte_idx, encode);
                if (!encode) {
                    obj = textDecoder.decode(new Uint8Array(obj));
                }
                return [obj, byte_idx];
                break;

        }
    } else if (Array.isArray(struct)) {
        // read or write this item  
        if (encode) {
            dv.setUint16(byte_idx, obj.length); 
            byte_idx += 2;
            for (e of obj){
                [_, byte_idx] = convert(dv, e, struct[0], byte_idx, encode)
            }            
            return [null, byte_idx];
        } else {
            let list_len = dv.getUint16(byte_idx);
            byte_idx += 2;
            let list_arr = Array(list_len);
            for (let i = 0; i < list_len; i++) {
                [list_arr[i], byte_idx] = convert(dv, e, struct[0], byte_idx, encode);
            };
            return [list_arr, byte_idx];
        }
    } else {
        // otherwise, recurse down to leaves
        for (k of Object.keys(struct).sort()){
            if (encode) {
                [_, byte_idx] = convert(dv, obj[k], struct[k], byte_idx, encode)
            } else {
                let a;
                [a, byte_idx] = convert(dv, {}, struct[k], byte_idx, encode)
                obj[k] = a;
            }
        }
        return obj;
    }
}

const VERSION_DATA_STRUCT = {
    0x1: {
        "dt":"f32",
        "dim_n":"ui8",
        "m1":"f32",
        "s1":"f32",
        "w1":"f32",
        "m2":"f32",
        "s2":"f32",
        "repulsion":"f32",
        "points":["f32"] //variable length list of f32
    },
    0x2: { // CHANGES vs 0x1: add creature name 
        "dt":"f32",
        "dim_n":"ui8",
        "m1":"f32",
        "s1":"f32",
        "w1":"f32",
        "m2":"f32",
        "s2":"f32",
        "repulsion":"f32",
        "points":["f32"], //variable length list of f32
        "name":"str" //variable length list of utf8-encoded name of creature
    }
};
