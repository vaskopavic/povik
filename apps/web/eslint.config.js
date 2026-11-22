import react from '@povik/config/eslint/react';

export default [
  ...react,
  {
    // Route files export `Route` next to their components (the router plugin splits them for
    // fast refresh), and shadcn components export their variants next to the component.
    files: ['src/routes/**', 'src/components/ui/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
];
