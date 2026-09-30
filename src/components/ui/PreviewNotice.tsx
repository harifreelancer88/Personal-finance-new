export function PreviewNotice({ children }: { children: string }) {
  return <aside className="preview-notice" aria-label="Preview feature"><strong>Preview · sample data</strong><p>{children}</p></aside>
}
