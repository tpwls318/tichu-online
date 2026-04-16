import React from 'react';
import './Card.css';

interface CardProps {
  suit: string;
  value: number;
  id: string;
  isSelected?: boolean;
  disableHover?: boolean;
  highlightColor?: string;
  onClick?: () => void;
}


export const CardComponent: React.FC<CardProps> = ({ suit, value, id, isSelected, disableHover, highlightColor, onClick }) => {
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

  const getSuitDetails = (s: string) => {
    switch(s) {
      case 'Star': return { icon: '★', color: '#cb4335' }; // Medium Red
      case 'Pagoda': return { icon: '♥', color: '#2980b9' }; // Medium Blue
      case 'Sword': return { icon: '⚡', color: '#9fa118' }; // Medium Olive/Gold
      case 'Jade': return { icon: '♣', color: '#27ae60' }; // Medium Green
      default: return { icon: '', color: '#333' };
    }
  };

  const getDisplayValue = (v: number) => {
    if (v === 11) return 'J';
    if (v === 12) return 'Q';
    if (v === 13) return 'K';
    if (v === 14) return 'A';
    return v.toString();
  };

  let icon = '';
  let displayValue = '';
  let cardColor = '';
  const isSpecial = ['Dragon', 'Phoenix', 'Dog', 'Sparrow'].includes(id);

  if (isSpecial) {
    // We don't need simplified details for special cards anymore, but keeping colors as fallback.
    if (id === 'Sparrow') { cardColor = '#8e44ad'; }
    if (id === 'Dog') { cardColor = '#e67e22'; }
    if (id === 'Phoenix') { cardColor = '#e74c3c'; }
    if (id === 'Dragon') { cardColor = '#c0392b'; }
  } else {
    const details = getSuitDetails(suit);
    icon = details.icon;
    cardColor = details.color;
    displayValue = getDisplayValue(value);
  }

  // Use a custom property for color to apply in CSS easily
  const customStyles = {
    '--card-color': cardColor,
    ...(highlightColor ? { outline: `3px solid ${highlightColor}`, outlineOffset: '-3px' } : {})
  } as React.CSSProperties;

  return (
    <div 
      className={`card ${isSelected ? 'selected' : ''} ${disableHover ? 'disable-hover' : ''} ${isSpecial ? 'is-special' : ''}`}
      onClick={onClick}
      style={customStyles}
    >
      <img className={`card-image-full ${isSpecial ? 'always-show' : ''}`} src={imagePath} alt={id} draggable="false" />
      {!isSpecial && (
        <div className="card-simplified">
           <div className="card-icon">{icon}</div>
           <div className="card-value">{displayValue}</div>
        </div>
      )}
    </div>
  );
};
