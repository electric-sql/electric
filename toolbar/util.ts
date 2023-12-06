export function addToolbar() {
  import('@electric-sql/debug-toolbar').then((toolbar) => {
    import('electric-sql/satellite').then((satellite) => {
      import('@electric-sql/debug-toolbar/dist/index.cjs.css').then((_) => {
        toolbar.default(toolbar.clientApi(satellite.globalRegistry))
      })
    })
  })
}
