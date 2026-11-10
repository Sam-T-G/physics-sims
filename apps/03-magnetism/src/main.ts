// Standalone entry. A hub would import mount/unmount from ./sim instead of this file.
import '@fontsource-variable/nunito'
import '@fontsource-variable/nunito/wght-italic.css'
import { mount } from './sim'

const el = document.getElementById('sim03-mount')
if (el) mount(el)
