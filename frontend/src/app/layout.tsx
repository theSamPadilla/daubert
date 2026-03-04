import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Daubert',
  description: 'Blockchain transaction investigation tool',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
