// Standalone entry. The hub imports mount/unmount from ./sim instead of this file.
import { mount } from './sim'

const el = document.getElementById('sim01-mount')
if (el) mount(el, { basePath: import.meta.env.BASE_URL })
