interface GalleryItem {
  name: string;
  imageUrl: string;
  category: string;
  accentColor: string; // hex color for border
}

interface FoodImageGalleryProps {
  items: GalleryItem[];
}

export function FoodImageGallery({ items }: FoodImageGalleryProps): JSX.Element {
  if (items.length === 0) {
    return <></>;
  }

  return (
    <div className="ia-gallery-grid">
      {items.map((item, index) => (
        <div
          key={item.name}
          className="ia-gallery-card"
          style={{
            borderRadius: '24px',
            border: `3px solid ${hexToRgba(item.accentColor, 0.35)}`,
            overflow: 'hidden',
            position: 'relative',
            aspectRatio: '4 / 3',
            animation: 'ia-float 7s ease-in-out infinite',
            animationDelay: `${index * 0.8}s`,
          }}
        >
          <img
            src={item.imageUrl}
            alt={item.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              backgroundColor: '#0F1D17',
            }}
          />
          <span
            className="ia-gallery-badge"
            style={{
              position: 'absolute',
              bottom: '16px',
              left: '16px',
              borderRadius: '999px',
              padding: '8px 16px',
              backgroundColor: item.accentColor,
              color: '#0F1D17',
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              pointerEvents: 'none',
            }}
          >
            {item.category}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Convert a hex color to rgba with the given alpha */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
