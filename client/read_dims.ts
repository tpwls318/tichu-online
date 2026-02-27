import sharp from 'sharp';

async function run() {
  try {
    const metadata = await sharp('public/cards_sprite.png').metadata();
    console.log(`Dimensions: ${metadata.width}x${metadata.height}`);
  } catch (err) {
    console.error('Error reading image metadata:', err);
  }
}
run();
