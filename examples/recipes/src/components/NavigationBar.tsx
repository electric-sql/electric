import logo from '../assets/electric_logo.svg'


export const NavigationBar = ({ title } : { title: string }) => (
  <nav className="grid grid-cols-3 gap-4 items-center p-2 box-content border-b-2 border-gray-200 bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
    <img src={logo} className="h-12" />
    <h2 className="text-xl font-semibold whitespace-nowrap text-gray-200 rounded-lg justify-self-center">{title}</h2>
  </nav>
)