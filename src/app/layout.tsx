// public: the root shell; renders no data
import './quorum.css';

export const metadata = { title: 'Quorum' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
