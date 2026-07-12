export function generatePayoutRef(): string {
  const indianTime = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }),
  );

  const yyyy = indianTime.getFullYear();
  const month = String(indianTime.getMonth() + 1).padStart(2, '0');
  const day = String(indianTime.getDate()).padStart(2, '0');
  const hours = String(indianTime.getHours()).padStart(2, '0');
  const minutes = String(indianTime.getMinutes()).padStart(2, '0');
  const seconds = String(indianTime.getSeconds()).padStart(2, '0');
  const suffix = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');

  return `${yyyy}${month}${day}${hours}${minutes}${seconds}${suffix}`;
}
