const sharp = require('sharp');
const fs = require('fs');

const SPRITE_PATH = 'public/cards_sprite.png';
const OUT_DIR = 'public/cards';

const cols = 15;
const rows = 4;

// 유저가 측정한 정확한 카드 내부 크기 (보더 제외) 및 여백(Gap)
const cardW = 213; // Width without border
const cardH = 300; // Height without border
const gapX = 45;   // Horizontal gap between cards WITHOUT border
const gapY = 33;   // Vertical gap between cards WITHOUT border

const offsetX = 1; // 시작점 (좌측 여백)
const offsetY = 2; // 시작점 (상단 여백)

async function slice() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const image = sharp(SPRITE_PATH);
  
  const suits = ['Pagoda', 'Star', 'Jade', 'Sword'];
  const values = [14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const specials = ['Sparrow', 'Dog', 'Phoenix', 'Dragon'];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let fileName = '';
      
      if (c < 13) {
        fileName = `${suits[r]}_${values[c]}.png`;
      } else if (c === 13) {
        fileName = `${specials[r]}.png`;
      } else if (c === 14 && r === 0) {
        fileName = `Back.png`;
      } else {
        continue;
      }

      // 시작점(1, 2)에서 컬럼인덱스 * (카드크기 + 여백)
      let left = offsetX + c * (cardW + gapX);
      
      // 세로 여백이 규칙적이지 않으므로 (2번째와 3번째 줄 사이는 37) 누적 계산
      let top = offsetY;
      for (let i = 0; i < r; i++) {
        const currentGapY = (i === 1) ? 37 : gapY;
        top += cardH + currentGapY;
      }

      // Back 카드 위치 강제 지정 (유저가 측정한 보더 없는 내부 오프셋)
      if (fileName === 'Back.png') {
        left = 3618;
        top = 495;
      }
      
      try {
        await image.clone()
          .extract({ left, top, width: cardW, height: cardH })
          .toFile(`${OUT_DIR}/${fileName}`);
        
        console.log(`Saved ${fileName} (left:${left}, top:${top})`);
      } catch (err) {
        console.error(`Error saving ${fileName}:`, err.message);
      }
    }
  }
}

slice().catch(console.error);
