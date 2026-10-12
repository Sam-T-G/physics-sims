// Standalone entry. The hub imports mount/unmount from ./sim instead of this file.
import '@fontsource-variable/nunito'
import '@fontsource-variable/nunito/wght-italic.css'
import { mount } from './sim'

const el = document.getElementById('sim02-mount')
if (el) mount(el, { basePath: import.meta.env.BASE_URL })
