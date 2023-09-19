describe('My First Test', () => {
  it('Visits the app root url', () => {
    cy.visit('/')
    cy.contains('ion-header', 'Inbox')
  })
})