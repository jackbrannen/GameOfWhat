export const metadata = { title: "The Game of What" }

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
        {children}
      </body>
    </html>
  )
}
