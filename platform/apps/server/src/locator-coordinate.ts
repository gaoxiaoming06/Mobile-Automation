export function scaleLocatorCoordinate(value: number, sourceSize: number | undefined, targetSize: number): number {
  if (!sourceSize || !targetSize || sourceSize === targetSize) {
    return value;
  }
  const ratio = targetSize / sourceSize;
  if (ratio >= 0.9 && ratio <= 1.1 && value >= 0 && value <= targetSize) {
    return value;
  }
  return (value / sourceSize) * targetSize;
}
