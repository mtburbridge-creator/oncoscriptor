// Fixture generator: no image libraries, no committed binaries.
const fs = require('fs'), path = require('path');

// A JPEG carrying EXIF orientation 6 (stored landscape, displayed portrait).
// Built by hand: SOI, then an APP1 segment holding a minimal TIFF IFD whose
// only entry is tag 0x0112 = 6.
function withExifOrientation6(jpegBuf) {
  const app1 = Buffer.from([
    0xFF, 0xE1, 0x00, 0x22,                          // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,              // "Exif\0\0"
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,  // TIFF header, little-endian
    0x01, 0x00,                                      // 1 IFD entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,  // tag 0x0112, SHORT, count 1
    0x06, 0x00, 0x00, 0x00,                          // value 6
    0x00, 0x00, 0x00, 0x00                           // no next IFD
  ]);
  return Buffer.concat([jpegBuf.subarray(0, 2), app1, jpegBuf.subarray(2)]);
}

async function makeFixtures(page, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, dataURL) =>
    fs.writeFileSync(path.join(dir, name), Buffer.from(dataURL.split(',')[1], 'base64'));

  const draw = (w, h, type, q) => page.evaluate(([w, h, type, q]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#4a6ebe'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 7) for (let j = 0; j < h; j += 5) {
      x.fillStyle = `rgb(${(i * 7) % 255},${(j * 11) % 255},${(i + j) % 255})`;
      x.fillRect(i, j, 3, 3);
    }
    return c.toDataURL(type, q);
  }, [w, h, type, q]);

  const png = await draw(320, 180, 'image/png');
  ['0.png','1.png','2.png','3.png','3a.png','5.png','9.png','10.png','pic "one" & <two>.png']
    .forEach(n => write(n, png));

  const big = await draw(1800, 1200, 'image/jpeg', 0.95);
  ['big1.jpg', 'big2.jpg'].forEach(n => write(n, big));

  const small = await draw(120, 80, 'image/jpeg', 0.9);
  fs.writeFileSync(path.join(dir, 'exif6.jpg'),
    withExifOrientation6(Buffer.from(small.split(',')[1], 'base64')));

  // A 3-frame animated GIF, hand-assembled (canvas cannot encode GIF).
  fs.writeFileSync(path.join(dir, 'anim.gif'), Buffer.from(
    'R0lGODlhCgAKAIAAAP///wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQJZAAAACwAAAAACgAKAAACC4' +
    'yPqcvtD6OctNoAIfkECWQAAAAsAAAAAAoACgAAAguMj6nL7Q+jnLTaACH5BAlkAAAALAAAAAAKAAoA' +
    'AAILjI+py+0Po5y02gAAOw==', 'base64'));

  fs.writeFileSync(path.join(dir, 'fake.heic'), Buffer.alloc(64));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
  fs.writeFileSync(path.join(dir, 'vec.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
}
module.exports = { makeFixtures };
