window.drawIcon = async function drawIcon(size) {
  await document.fonts.load('800 100px "Pretendard Variable"', '721');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(size / 1024, size / 1024);

  ctx.fillStyle = '#3A5BEF';
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(300, 680);
  ctx.quadraticCurveTo(292, 790, 226, 842);
  ctx.quadraticCurveTo(352, 830, 456, 690);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(152, 236, 720, 480, 160);
  ctx.fill();

  ctx.fillStyle = '#3A5BEF';
  ctx.font = '800 300px "Pretendard Variable"';
  ctx.letterSpacing = '-10px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('721', 507, 584);

  return canvas.toDataURL('image/png');
};
