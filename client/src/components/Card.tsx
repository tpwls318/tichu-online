import React from 'react';
import './Card.css';

interface CardProps {
  suit: string;
  value: number;
  id: string;
  isSelected?: boolean;
  disableHover?: boolean;
  onClick?: () => void;
}


export const CardComponent: React.FC<CardProps> = ({ suit, value, id, isSelected, disableHover, onClick }) => {
  // The ID from the backend might be lowercase (e.g., 'sword_14').
  // Our images are capitalized (e.g., 'Sword_14.png', 'Dragon.png').
  // It's safer to reconstruct the filename using the suit and value props which have correct casing.
  let imageFileName = '';
  if (['Dragon', 'Phoenix', 'Dog', 'Sparrow'].includes(id)) {
    // Special cards have their id exactly as the filename
    imageFileName = id;
  } else {
    // Regular cards use Suit_Value.png
    imageFileName = `${suit}_${value}`;
  }
  
  const imagePath = `/cards/${imageFileName}.png`;

  return (
    <div 
      className={`card ${isSelected ? 'selected' : ''} ${disableHover ? 'disable-hover' : ''}`}
      onClick={onClick}
    >
      <img src={imagePath} alt={id} style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable="false" />
    </div>
  );
};
