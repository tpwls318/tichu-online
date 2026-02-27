const sharp = require('sharp');
async function check() {
  const metadata = await sharp('public/cards_sprite.png').metadata();
  console.log('Has alpha:', metadata.hasAlpha);
}
check();
