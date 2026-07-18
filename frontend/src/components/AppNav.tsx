import { Link } from 'react-router-dom'

export function AppNav() {
  return (
    <nav>
      <Link to="/documents">Documents</Link>
      <Link to="/search">Search</Link>
    </nav>
  )
}
