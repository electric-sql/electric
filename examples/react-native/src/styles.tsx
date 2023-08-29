import { StyleSheet } from 'react-native'

export const styles = StyleSheet.create({
  buttons: {
    flex: 1,
    flexDirection: 'row'
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    margin: '5%',
    marginBottom: 8,
    borderRadius: 8,
    elevation: 3,
    backgroundColor: '#1e2123',
    color: '#f9fdff',
    width: '40%',
    height: 50
  },
  iconContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20
  },
  items: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'top',
    height: 140
  },
  item: {
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: 0.25,
    margin: '5%',
    marginBottom: 4,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#1e2123',
    color: '#f9fdff',
    width: '90%',
    textAlign: 'center'
  },
  text: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: 'bold',
    letterSpacing: 0.25,
    color: '#f9fdff',
  },
})
