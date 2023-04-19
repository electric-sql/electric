'use strict'
var ip = Object.create
var lr = Object.defineProperty
var op = Object.getOwnPropertyDescriptor
var sp = Object.getOwnPropertyNames
var ap = Object.getPrototypeOf,
  lp = Object.prototype.hasOwnProperty
var a = (e, t) => lr(e, 'name', { value: t, configurable: !0 })
var F = (e, t) => () => (t || e((t = { exports: {} }).exports, t), t.exports),
  gn = (e, t) => {
    for (var r in t) lr(e, r, { get: t[r], enumerable: !0 })
  },
  ms = (e, t, r, n) => {
    if ((t && typeof t == 'object') || typeof t == 'function')
      for (let i of sp(t))
        !lp.call(e, i) &&
          i !== r &&
          lr(e, i, {
            get: () => t[i],
            enumerable: !(n = op(t, i)) || n.enumerable,
          })
    return e
  }
var O = (e, t, r) => (
    (r = e != null ? ip(ap(e)) : {}),
    ms(
      t || !e || !e.__esModule
        ? lr(r, 'default', { value: e, enumerable: !0 })
        : r,
      e
    )
  ),
  up = (e) => ms(lr({}, '__esModule', { value: !0 }), e)
var gs = F((ry, hn) => {
  var cp = (function () {
    var e = String.fromCharCode,
      t = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',
      r = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$',
      n = {}
    function i(s, l) {
      if (!n[s]) {
        n[s] = {}
        for (var u = 0; u < s.length; u++) n[s][s.charAt(u)] = u
      }
      return n[s][l]
    }
    a(i, 'getBaseValue')
    var o = {
      compressToBase64: function (s) {
        if (s == null) return ''
        var l = o._compress(s, 6, function (u) {
          return t.charAt(u)
        })
        switch (l.length % 4) {
          default:
          case 0:
            return l
          case 1:
            return l + '==='
          case 2:
            return l + '=='
          case 3:
            return l + '='
        }
      },
      decompressFromBase64: function (s) {
        return s == null
          ? ''
          : s == ''
          ? null
          : o._decompress(s.length, 32, function (l) {
              return i(t, s.charAt(l))
            })
      },
      compressToUTF16: function (s) {
        return s == null
          ? ''
          : o._compress(s, 15, function (l) {
              return e(l + 32)
            }) + ' '
      },
      decompressFromUTF16: function (s) {
        return s == null
          ? ''
          : s == ''
          ? null
          : o._decompress(s.length, 16384, function (l) {
              return s.charCodeAt(l) - 32
            })
      },
      compressToUint8Array: function (s) {
        for (
          var l = o.compress(s),
            u = new Uint8Array(l.length * 2),
            c = 0,
            p = l.length;
          c < p;
          c++
        ) {
          var f = l.charCodeAt(c)
          ;(u[c * 2] = f >>> 8), (u[c * 2 + 1] = f % 256)
        }
        return u
      },
      decompressFromUint8Array: function (s) {
        if (s == null) return o.decompress(s)
        for (var l = new Array(s.length / 2), u = 0, c = l.length; u < c; u++)
          l[u] = s[u * 2] * 256 + s[u * 2 + 1]
        var p = []
        return (
          l.forEach(function (f) {
            p.push(e(f))
          }),
          o.decompress(p.join(''))
        )
      },
      compressToEncodedURIComponent: function (s) {
        return s == null
          ? ''
          : o._compress(s, 6, function (l) {
              return r.charAt(l)
            })
      },
      decompressFromEncodedURIComponent: function (s) {
        return s == null
          ? ''
          : s == ''
          ? null
          : ((s = s.replace(/ /g, '+')),
            o._decompress(s.length, 32, function (l) {
              return i(r, s.charAt(l))
            }))
      },
      compress: function (s) {
        return o._compress(s, 16, function (l) {
          return e(l)
        })
      },
      _compress: function (s, l, u) {
        if (s == null) return ''
        var c,
          p,
          f = {},
          d = {},
          m = '',
          h = '',
          g = '',
          b = 2,
          y = 3,
          x = 2,
          E = [],
          w = 0,
          T = 0,
          C
        for (C = 0; C < s.length; C += 1)
          if (
            ((m = s.charAt(C)),
            Object.prototype.hasOwnProperty.call(f, m) ||
              ((f[m] = y++), (d[m] = !0)),
            (h = g + m),
            Object.prototype.hasOwnProperty.call(f, h))
          )
            g = h
          else {
            if (Object.prototype.hasOwnProperty.call(d, g)) {
              if (g.charCodeAt(0) < 256) {
                for (c = 0; c < x; c++)
                  (w = w << 1),
                    T == l - 1 ? ((T = 0), E.push(u(w)), (w = 0)) : T++
                for (p = g.charCodeAt(0), c = 0; c < 8; c++)
                  (w = (w << 1) | (p & 1)),
                    T == l - 1 ? ((T = 0), E.push(u(w)), (w = 0)) : T++,
                    (p = p >> 1)
              } else {
                for (p = 1, c = 0; c < x; c++)
                  (w = (w << 1) | p),
                    T == l - 1 ? ((T = 0), E.push(u(w)), (w = 0)) : T++,
                    (p = 0)
                for (p = g.charCodeAt(0), c = 0; c < 16; c++)
                  (w = (w << 1) | (p & 1)),
                    T == l - 1 ? ((T = 0), E.push(u(w)), (w = 0)) : T++,
                    (p = p >> 1)
              }
              b--, b == 0 && ((b = Math.pow(2, x)), x++), delete d[g]
            } else
              for (p = f[g], c = 0; c < x; c++)
                (w = (w << 1) | (p & 1)),
                  T == l - 1 ? ((T = 0), E.push(u(w)), (w = 0)) : T++,
                  (p = p >> 1)
            b--,
              b == 0 && ((b = Math.pow(2, x)), x++),
              (f[h] = y++),
              (g = String(m))
          }
        if (g !== '') {
          if (Object.prototype.hasOwnProperty.call(d, g)) {
            if (g.charCodeAt(0) < 256) {
              for (c = 0; c < x; c++)
                (w = w << 1),
                  T == l - 1 ? ((T = 0), E.push(u(w)), (w = 0)) : T++
              for (p = g.charCodeAt(0), c = 0; c < 8; c++)
                (w = (w << 1) | (p & 1)),
                  T == l - 1 ? ((T = 0), E.push(u(w)), (w = 0)) : T++,
                  (p = p >> 1)
            } else {
              for (p = 1, c = 0; c < x; c++)
                (w = (w << 1) | p),
                  T == l - 1 ? ((T = 0), E.push(u(w)), (w = 0)) : T++,
                  (p = 0)
              for (p = g.charCodeAt(0), c = 0; c < 16; c++)
                (w = (w << 1) | (p & 1)),
                  T == l - 1 ? ((T = 0), E.push(u(w)), (w = 0)) : T++,
                  (p = p >> 1)
            }
            b--, b == 0 && ((b = Math.pow(2, x)), x++), delete d[g]
          } else
            for (p = f[g], c = 0; c < x; c++)
              (w = (w << 1) | (p & 1)),
                T == l - 1 ? ((T = 0), E.push(u(w)), (w = 0)) : T++,
                (p = p >> 1)
          b--, b == 0 && ((b = Math.pow(2, x)), x++)
        }
        for (p = 2, c = 0; c < x; c++)
          (w = (w << 1) | (p & 1)),
            T == l - 1 ? ((T = 0), E.push(u(w)), (w = 0)) : T++,
            (p = p >> 1)
        for (;;)
          if (((w = w << 1), T == l - 1)) {
            E.push(u(w))
            break
          } else T++
        return E.join('')
      },
      decompress: function (s) {
        return s == null
          ? ''
          : s == ''
          ? null
          : o._decompress(s.length, 32768, function (l) {
              return s.charCodeAt(l)
            })
      },
      _decompress: function (s, l, u) {
        var c = [],
          p,
          f = 4,
          d = 4,
          m = 3,
          h = '',
          g = [],
          b,
          y,
          x,
          E,
          w,
          T,
          C,
          S = { val: u(0), position: l, index: 1 }
        for (b = 0; b < 3; b += 1) c[b] = b
        for (x = 0, w = Math.pow(2, 2), T = 1; T != w; )
          (E = S.val & S.position),
            (S.position >>= 1),
            S.position == 0 && ((S.position = l), (S.val = u(S.index++))),
            (x |= (E > 0 ? 1 : 0) * T),
            (T <<= 1)
        switch ((p = x)) {
          case 0:
            for (x = 0, w = Math.pow(2, 8), T = 1; T != w; )
              (E = S.val & S.position),
                (S.position >>= 1),
                S.position == 0 && ((S.position = l), (S.val = u(S.index++))),
                (x |= (E > 0 ? 1 : 0) * T),
                (T <<= 1)
            C = e(x)
            break
          case 1:
            for (x = 0, w = Math.pow(2, 16), T = 1; T != w; )
              (E = S.val & S.position),
                (S.position >>= 1),
                S.position == 0 && ((S.position = l), (S.val = u(S.index++))),
                (x |= (E > 0 ? 1 : 0) * T),
                (T <<= 1)
            C = e(x)
            break
          case 2:
            return ''
        }
        for (c[3] = C, y = C, g.push(C); ; ) {
          if (S.index > s) return ''
          for (x = 0, w = Math.pow(2, m), T = 1; T != w; )
            (E = S.val & S.position),
              (S.position >>= 1),
              S.position == 0 && ((S.position = l), (S.val = u(S.index++))),
              (x |= (E > 0 ? 1 : 0) * T),
              (T <<= 1)
          switch ((C = x)) {
            case 0:
              for (x = 0, w = Math.pow(2, 8), T = 1; T != w; )
                (E = S.val & S.position),
                  (S.position >>= 1),
                  S.position == 0 && ((S.position = l), (S.val = u(S.index++))),
                  (x |= (E > 0 ? 1 : 0) * T),
                  (T <<= 1)
              ;(c[d++] = e(x)), (C = d - 1), f--
              break
            case 1:
              for (x = 0, w = Math.pow(2, 16), T = 1; T != w; )
                (E = S.val & S.position),
                  (S.position >>= 1),
                  S.position == 0 && ((S.position = l), (S.val = u(S.index++))),
                  (x |= (E > 0 ? 1 : 0) * T),
                  (T <<= 1)
              ;(c[d++] = e(x)), (C = d - 1), f--
              break
            case 2:
              return g.join('')
          }
          if ((f == 0 && ((f = Math.pow(2, m)), m++), c[C])) h = c[C]
          else if (C === d) h = y + y.charAt(0)
          else return null
          g.push(h),
            (c[d++] = y + h.charAt(0)),
            f--,
            (y = h),
            f == 0 && ((f = Math.pow(2, m)), m++)
        }
      },
    }
    return o
  })()
  typeof hn < 'u' && hn != null && (hn.exports = cp)
})
var vs = F((my, xs) => {
  'use strict'
  xs.exports = {
    aliceblue: [240, 248, 255],
    antiquewhite: [250, 235, 215],
    aqua: [0, 255, 255],
    aquamarine: [127, 255, 212],
    azure: [240, 255, 255],
    beige: [245, 245, 220],
    bisque: [255, 228, 196],
    black: [0, 0, 0],
    blanchedalmond: [255, 235, 205],
    blue: [0, 0, 255],
    blueviolet: [138, 43, 226],
    brown: [165, 42, 42],
    burlywood: [222, 184, 135],
    cadetblue: [95, 158, 160],
    chartreuse: [127, 255, 0],
    chocolate: [210, 105, 30],
    coral: [255, 127, 80],
    cornflowerblue: [100, 149, 237],
    cornsilk: [255, 248, 220],
    crimson: [220, 20, 60],
    cyan: [0, 255, 255],
    darkblue: [0, 0, 139],
    darkcyan: [0, 139, 139],
    darkgoldenrod: [184, 134, 11],
    darkgray: [169, 169, 169],
    darkgreen: [0, 100, 0],
    darkgrey: [169, 169, 169],
    darkkhaki: [189, 183, 107],
    darkmagenta: [139, 0, 139],
    darkolivegreen: [85, 107, 47],
    darkorange: [255, 140, 0],
    darkorchid: [153, 50, 204],
    darkred: [139, 0, 0],
    darksalmon: [233, 150, 122],
    darkseagreen: [143, 188, 143],
    darkslateblue: [72, 61, 139],
    darkslategray: [47, 79, 79],
    darkslategrey: [47, 79, 79],
    darkturquoise: [0, 206, 209],
    darkviolet: [148, 0, 211],
    deeppink: [255, 20, 147],
    deepskyblue: [0, 191, 255],
    dimgray: [105, 105, 105],
    dimgrey: [105, 105, 105],
    dodgerblue: [30, 144, 255],
    firebrick: [178, 34, 34],
    floralwhite: [255, 250, 240],
    forestgreen: [34, 139, 34],
    fuchsia: [255, 0, 255],
    gainsboro: [220, 220, 220],
    ghostwhite: [248, 248, 255],
    gold: [255, 215, 0],
    goldenrod: [218, 165, 32],
    gray: [128, 128, 128],
    green: [0, 128, 0],
    greenyellow: [173, 255, 47],
    grey: [128, 128, 128],
    honeydew: [240, 255, 240],
    hotpink: [255, 105, 180],
    indianred: [205, 92, 92],
    indigo: [75, 0, 130],
    ivory: [255, 255, 240],
    khaki: [240, 230, 140],
    lavender: [230, 230, 250],
    lavenderblush: [255, 240, 245],
    lawngreen: [124, 252, 0],
    lemonchiffon: [255, 250, 205],
    lightblue: [173, 216, 230],
    lightcoral: [240, 128, 128],
    lightcyan: [224, 255, 255],
    lightgoldenrodyellow: [250, 250, 210],
    lightgray: [211, 211, 211],
    lightgreen: [144, 238, 144],
    lightgrey: [211, 211, 211],
    lightpink: [255, 182, 193],
    lightsalmon: [255, 160, 122],
    lightseagreen: [32, 178, 170],
    lightskyblue: [135, 206, 250],
    lightslategray: [119, 136, 153],
    lightslategrey: [119, 136, 153],
    lightsteelblue: [176, 196, 222],
    lightyellow: [255, 255, 224],
    lime: [0, 255, 0],
    limegreen: [50, 205, 50],
    linen: [250, 240, 230],
    magenta: [255, 0, 255],
    maroon: [128, 0, 0],
    mediumaquamarine: [102, 205, 170],
    mediumblue: [0, 0, 205],
    mediumorchid: [186, 85, 211],
    mediumpurple: [147, 112, 219],
    mediumseagreen: [60, 179, 113],
    mediumslateblue: [123, 104, 238],
    mediumspringgreen: [0, 250, 154],
    mediumturquoise: [72, 209, 204],
    mediumvioletred: [199, 21, 133],
    midnightblue: [25, 25, 112],
    mintcream: [245, 255, 250],
    mistyrose: [255, 228, 225],
    moccasin: [255, 228, 181],
    navajowhite: [255, 222, 173],
    navy: [0, 0, 128],
    oldlace: [253, 245, 230],
    olive: [128, 128, 0],
    olivedrab: [107, 142, 35],
    orange: [255, 165, 0],
    orangered: [255, 69, 0],
    orchid: [218, 112, 214],
    palegoldenrod: [238, 232, 170],
    palegreen: [152, 251, 152],
    paleturquoise: [175, 238, 238],
    palevioletred: [219, 112, 147],
    papayawhip: [255, 239, 213],
    peachpuff: [255, 218, 185],
    peru: [205, 133, 63],
    pink: [255, 192, 203],
    plum: [221, 160, 221],
    powderblue: [176, 224, 230],
    purple: [128, 0, 128],
    rebeccapurple: [102, 51, 153],
    red: [255, 0, 0],
    rosybrown: [188, 143, 143],
    royalblue: [65, 105, 225],
    saddlebrown: [139, 69, 19],
    salmon: [250, 128, 114],
    sandybrown: [244, 164, 96],
    seagreen: [46, 139, 87],
    seashell: [255, 245, 238],
    sienna: [160, 82, 45],
    silver: [192, 192, 192],
    skyblue: [135, 206, 235],
    slateblue: [106, 90, 205],
    slategray: [112, 128, 144],
    slategrey: [112, 128, 144],
    snow: [255, 250, 250],
    springgreen: [0, 255, 127],
    steelblue: [70, 130, 180],
    tan: [210, 180, 140],
    teal: [0, 128, 128],
    thistle: [216, 191, 216],
    tomato: [255, 99, 71],
    turquoise: [64, 224, 208],
    violet: [238, 130, 238],
    wheat: [245, 222, 179],
    white: [255, 255, 255],
    whitesmoke: [245, 245, 245],
    yellow: [255, 255, 0],
    yellowgreen: [154, 205, 50],
  }
})
var ji = F((gy, As) => {
  var ur = vs(),
    Ts = {}
  for (let e of Object.keys(ur)) Ts[ur[e]] = e
  var P = {
    rgb: { channels: 3, labels: 'rgb' },
    hsl: { channels: 3, labels: 'hsl' },
    hsv: { channels: 3, labels: 'hsv' },
    hwb: { channels: 3, labels: 'hwb' },
    cmyk: { channels: 4, labels: 'cmyk' },
    xyz: { channels: 3, labels: 'xyz' },
    lab: { channels: 3, labels: 'lab' },
    lch: { channels: 3, labels: 'lch' },
    hex: { channels: 1, labels: ['hex'] },
    keyword: { channels: 1, labels: ['keyword'] },
    ansi16: { channels: 1, labels: ['ansi16'] },
    ansi256: { channels: 1, labels: ['ansi256'] },
    hcg: { channels: 3, labels: ['h', 'c', 'g'] },
    apple: { channels: 3, labels: ['r16', 'g16', 'b16'] },
    gray: { channels: 1, labels: ['gray'] },
  }
  As.exports = P
  for (let e of Object.keys(P)) {
    if (!('channels' in P[e]))
      throw new Error('missing channels property: ' + e)
    if (!('labels' in P[e]))
      throw new Error('missing channel labels property: ' + e)
    if (P[e].labels.length !== P[e].channels)
      throw new Error('channel and label counts mismatch: ' + e)
    let { channels: t, labels: r } = P[e]
    delete P[e].channels,
      delete P[e].labels,
      Object.defineProperty(P[e], 'channels', { value: t }),
      Object.defineProperty(P[e], 'labels', { value: r })
  }
  P.rgb.hsl = function (e) {
    let t = e[0] / 255,
      r = e[1] / 255,
      n = e[2] / 255,
      i = Math.min(t, r, n),
      o = Math.max(t, r, n),
      s = o - i,
      l,
      u
    o === i
      ? (l = 0)
      : t === o
      ? (l = (r - n) / s)
      : r === o
      ? (l = 2 + (n - t) / s)
      : n === o && (l = 4 + (t - r) / s),
      (l = Math.min(l * 60, 360)),
      l < 0 && (l += 360)
    let c = (i + o) / 2
    return (
      o === i ? (u = 0) : c <= 0.5 ? (u = s / (o + i)) : (u = s / (2 - o - i)),
      [l, u * 100, c * 100]
    )
  }
  P.rgb.hsv = function (e) {
    let t,
      r,
      n,
      i,
      o,
      s = e[0] / 255,
      l = e[1] / 255,
      u = e[2] / 255,
      c = Math.max(s, l, u),
      p = c - Math.min(s, l, u),
      f = a(function (d) {
        return (c - d) / 6 / p + 1 / 2
      }, 'diffc')
    return (
      p === 0
        ? ((i = 0), (o = 0))
        : ((o = p / c),
          (t = f(s)),
          (r = f(l)),
          (n = f(u)),
          s === c
            ? (i = n - r)
            : l === c
            ? (i = 1 / 3 + t - n)
            : u === c && (i = 2 / 3 + r - t),
          i < 0 ? (i += 1) : i > 1 && (i -= 1)),
      [i * 360, o * 100, c * 100]
    )
  }
  P.rgb.hwb = function (e) {
    let t = e[0],
      r = e[1],
      n = e[2],
      i = P.rgb.hsl(e)[0],
      o = (1 / 255) * Math.min(t, Math.min(r, n))
    return (
      (n = 1 - (1 / 255) * Math.max(t, Math.max(r, n))), [i, o * 100, n * 100]
    )
  }
  P.rgb.cmyk = function (e) {
    let t = e[0] / 255,
      r = e[1] / 255,
      n = e[2] / 255,
      i = Math.min(1 - t, 1 - r, 1 - n),
      o = (1 - t - i) / (1 - i) || 0,
      s = (1 - r - i) / (1 - i) || 0,
      l = (1 - n - i) / (1 - i) || 0
    return [o * 100, s * 100, l * 100, i * 100]
  }
  function pp(e, t) {
    return (e[0] - t[0]) ** 2 + (e[1] - t[1]) ** 2 + (e[2] - t[2]) ** 2
  }
  a(pp, 'comparativeDistance')
  P.rgb.keyword = function (e) {
    let t = Ts[e]
    if (t) return t
    let r = 1 / 0,
      n
    for (let i of Object.keys(ur)) {
      let o = ur[i],
        s = pp(e, o)
      s < r && ((r = s), (n = i))
    }
    return n
  }
  P.keyword.rgb = function (e) {
    return ur[e]
  }
  P.rgb.xyz = function (e) {
    let t = e[0] / 255,
      r = e[1] / 255,
      n = e[2] / 255
    ;(t = t > 0.04045 ? ((t + 0.055) / 1.055) ** 2.4 : t / 12.92),
      (r = r > 0.04045 ? ((r + 0.055) / 1.055) ** 2.4 : r / 12.92),
      (n = n > 0.04045 ? ((n + 0.055) / 1.055) ** 2.4 : n / 12.92)
    let i = t * 0.4124 + r * 0.3576 + n * 0.1805,
      o = t * 0.2126 + r * 0.7152 + n * 0.0722,
      s = t * 0.0193 + r * 0.1192 + n * 0.9505
    return [i * 100, o * 100, s * 100]
  }
  P.rgb.lab = function (e) {
    let t = P.rgb.xyz(e),
      r = t[0],
      n = t[1],
      i = t[2]
    ;(r /= 95.047),
      (n /= 100),
      (i /= 108.883),
      (r = r > 0.008856 ? r ** (1 / 3) : 7.787 * r + 16 / 116),
      (n = n > 0.008856 ? n ** (1 / 3) : 7.787 * n + 16 / 116),
      (i = i > 0.008856 ? i ** (1 / 3) : 7.787 * i + 16 / 116)
    let o = 116 * n - 16,
      s = 500 * (r - n),
      l = 200 * (n - i)
    return [o, s, l]
  }
  P.hsl.rgb = function (e) {
    let t = e[0] / 360,
      r = e[1] / 100,
      n = e[2] / 100,
      i,
      o,
      s
    if (r === 0) return (s = n * 255), [s, s, s]
    n < 0.5 ? (i = n * (1 + r)) : (i = n + r - n * r)
    let l = 2 * n - i,
      u = [0, 0, 0]
    for (let c = 0; c < 3; c++)
      (o = t + (1 / 3) * -(c - 1)),
        o < 0 && o++,
        o > 1 && o--,
        6 * o < 1
          ? (s = l + (i - l) * 6 * o)
          : 2 * o < 1
          ? (s = i)
          : 3 * o < 2
          ? (s = l + (i - l) * (2 / 3 - o) * 6)
          : (s = l),
        (u[c] = s * 255)
    return u
  }
  P.hsl.hsv = function (e) {
    let t = e[0],
      r = e[1] / 100,
      n = e[2] / 100,
      i = r,
      o = Math.max(n, 0.01)
    ;(n *= 2), (r *= n <= 1 ? n : 2 - n), (i *= o <= 1 ? o : 2 - o)
    let s = (n + r) / 2,
      l = n === 0 ? (2 * i) / (o + i) : (2 * r) / (n + r)
    return [t, l * 100, s * 100]
  }
  P.hsv.rgb = function (e) {
    let t = e[0] / 60,
      r = e[1] / 100,
      n = e[2] / 100,
      i = Math.floor(t) % 6,
      o = t - Math.floor(t),
      s = 255 * n * (1 - r),
      l = 255 * n * (1 - r * o),
      u = 255 * n * (1 - r * (1 - o))
    switch (((n *= 255), i)) {
      case 0:
        return [n, u, s]
      case 1:
        return [l, n, s]
      case 2:
        return [s, n, u]
      case 3:
        return [s, l, n]
      case 4:
        return [u, s, n]
      case 5:
        return [n, s, l]
    }
  }
  P.hsv.hsl = function (e) {
    let t = e[0],
      r = e[1] / 100,
      n = e[2] / 100,
      i = Math.max(n, 0.01),
      o,
      s
    s = (2 - r) * n
    let l = (2 - r) * i
    return (
      (o = r * i),
      (o /= l <= 1 ? l : 2 - l),
      (o = o || 0),
      (s /= 2),
      [t, o * 100, s * 100]
    )
  }
  P.hwb.rgb = function (e) {
    let t = e[0] / 360,
      r = e[1] / 100,
      n = e[2] / 100,
      i = r + n,
      o
    i > 1 && ((r /= i), (n /= i))
    let s = Math.floor(6 * t),
      l = 1 - n
    ;(o = 6 * t - s), (s & 1) !== 0 && (o = 1 - o)
    let u = r + o * (l - r),
      c,
      p,
      f
    switch (s) {
      default:
      case 6:
      case 0:
        ;(c = l), (p = u), (f = r)
        break
      case 1:
        ;(c = u), (p = l), (f = r)
        break
      case 2:
        ;(c = r), (p = l), (f = u)
        break
      case 3:
        ;(c = r), (p = u), (f = l)
        break
      case 4:
        ;(c = u), (p = r), (f = l)
        break
      case 5:
        ;(c = l), (p = r), (f = u)
        break
    }
    return [c * 255, p * 255, f * 255]
  }
  P.cmyk.rgb = function (e) {
    let t = e[0] / 100,
      r = e[1] / 100,
      n = e[2] / 100,
      i = e[3] / 100,
      o = 1 - Math.min(1, t * (1 - i) + i),
      s = 1 - Math.min(1, r * (1 - i) + i),
      l = 1 - Math.min(1, n * (1 - i) + i)
    return [o * 255, s * 255, l * 255]
  }
  P.xyz.rgb = function (e) {
    let t = e[0] / 100,
      r = e[1] / 100,
      n = e[2] / 100,
      i,
      o,
      s
    return (
      (i = t * 3.2406 + r * -1.5372 + n * -0.4986),
      (o = t * -0.9689 + r * 1.8758 + n * 0.0415),
      (s = t * 0.0557 + r * -0.204 + n * 1.057),
      (i = i > 0.0031308 ? 1.055 * i ** (1 / 2.4) - 0.055 : i * 12.92),
      (o = o > 0.0031308 ? 1.055 * o ** (1 / 2.4) - 0.055 : o * 12.92),
      (s = s > 0.0031308 ? 1.055 * s ** (1 / 2.4) - 0.055 : s * 12.92),
      (i = Math.min(Math.max(0, i), 1)),
      (o = Math.min(Math.max(0, o), 1)),
      (s = Math.min(Math.max(0, s), 1)),
      [i * 255, o * 255, s * 255]
    )
  }
  P.xyz.lab = function (e) {
    let t = e[0],
      r = e[1],
      n = e[2]
    ;(t /= 95.047),
      (r /= 100),
      (n /= 108.883),
      (t = t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116),
      (r = r > 0.008856 ? r ** (1 / 3) : 7.787 * r + 16 / 116),
      (n = n > 0.008856 ? n ** (1 / 3) : 7.787 * n + 16 / 116)
    let i = 116 * r - 16,
      o = 500 * (t - r),
      s = 200 * (r - n)
    return [i, o, s]
  }
  P.lab.xyz = function (e) {
    let t = e[0],
      r = e[1],
      n = e[2],
      i,
      o,
      s
    ;(o = (t + 16) / 116), (i = r / 500 + o), (s = o - n / 200)
    let l = o ** 3,
      u = i ** 3,
      c = s ** 3
    return (
      (o = l > 0.008856 ? l : (o - 16 / 116) / 7.787),
      (i = u > 0.008856 ? u : (i - 16 / 116) / 7.787),
      (s = c > 0.008856 ? c : (s - 16 / 116) / 7.787),
      (i *= 95.047),
      (o *= 100),
      (s *= 108.883),
      [i, o, s]
    )
  }
  P.lab.lch = function (e) {
    let t = e[0],
      r = e[1],
      n = e[2],
      i
    ;(i = (Math.atan2(n, r) * 360) / 2 / Math.PI), i < 0 && (i += 360)
    let s = Math.sqrt(r * r + n * n)
    return [t, s, i]
  }
  P.lch.lab = function (e) {
    let t = e[0],
      r = e[1],
      i = (e[2] / 360) * 2 * Math.PI,
      o = r * Math.cos(i),
      s = r * Math.sin(i)
    return [t, o, s]
  }
  P.rgb.ansi16 = function (e, t = null) {
    let [r, n, i] = e,
      o = t === null ? P.rgb.hsv(e)[2] : t
    if (((o = Math.round(o / 50)), o === 0)) return 30
    let s =
      30 +
      ((Math.round(i / 255) << 2) |
        (Math.round(n / 255) << 1) |
        Math.round(r / 255))
    return o === 2 && (s += 60), s
  }
  P.hsv.ansi16 = function (e) {
    return P.rgb.ansi16(P.hsv.rgb(e), e[2])
  }
  P.rgb.ansi256 = function (e) {
    let t = e[0],
      r = e[1],
      n = e[2]
    return t === r && r === n
      ? t < 8
        ? 16
        : t > 248
        ? 231
        : Math.round(((t - 8) / 247) * 24) + 232
      : 16 +
          36 * Math.round((t / 255) * 5) +
          6 * Math.round((r / 255) * 5) +
          Math.round((n / 255) * 5)
  }
  P.ansi16.rgb = function (e) {
    let t = e % 10
    if (t === 0 || t === 7)
      return e > 50 && (t += 3.5), (t = (t / 10.5) * 255), [t, t, t]
    let r = (~~(e > 50) + 1) * 0.5,
      n = (t & 1) * r * 255,
      i = ((t >> 1) & 1) * r * 255,
      o = ((t >> 2) & 1) * r * 255
    return [n, i, o]
  }
  P.ansi256.rgb = function (e) {
    if (e >= 232) {
      let o = (e - 232) * 10 + 8
      return [o, o, o]
    }
    e -= 16
    let t,
      r = (Math.floor(e / 36) / 5) * 255,
      n = (Math.floor((t = e % 36) / 6) / 5) * 255,
      i = ((t % 6) / 5) * 255
    return [r, n, i]
  }
  P.rgb.hex = function (e) {
    let r = (
      ((Math.round(e[0]) & 255) << 16) +
      ((Math.round(e[1]) & 255) << 8) +
      (Math.round(e[2]) & 255)
    )
      .toString(16)
      .toUpperCase()
    return '000000'.substring(r.length) + r
  }
  P.hex.rgb = function (e) {
    let t = e.toString(16).match(/[a-f0-9]{6}|[a-f0-9]{3}/i)
    if (!t) return [0, 0, 0]
    let r = t[0]
    t[0].length === 3 &&
      (r = r
        .split('')
        .map((l) => l + l)
        .join(''))
    let n = parseInt(r, 16),
      i = (n >> 16) & 255,
      o = (n >> 8) & 255,
      s = n & 255
    return [i, o, s]
  }
  P.rgb.hcg = function (e) {
    let t = e[0] / 255,
      r = e[1] / 255,
      n = e[2] / 255,
      i = Math.max(Math.max(t, r), n),
      o = Math.min(Math.min(t, r), n),
      s = i - o,
      l,
      u
    return (
      s < 1 ? (l = o / (1 - s)) : (l = 0),
      s <= 0
        ? (u = 0)
        : i === t
        ? (u = ((r - n) / s) % 6)
        : i === r
        ? (u = 2 + (n - t) / s)
        : (u = 4 + (t - r) / s),
      (u /= 6),
      (u %= 1),
      [u * 360, s * 100, l * 100]
    )
  }
  P.hsl.hcg = function (e) {
    let t = e[1] / 100,
      r = e[2] / 100,
      n = r < 0.5 ? 2 * t * r : 2 * t * (1 - r),
      i = 0
    return n < 1 && (i = (r - 0.5 * n) / (1 - n)), [e[0], n * 100, i * 100]
  }
  P.hsv.hcg = function (e) {
    let t = e[1] / 100,
      r = e[2] / 100,
      n = t * r,
      i = 0
    return n < 1 && (i = (r - n) / (1 - n)), [e[0], n * 100, i * 100]
  }
  P.hcg.rgb = function (e) {
    let t = e[0] / 360,
      r = e[1] / 100,
      n = e[2] / 100
    if (r === 0) return [n * 255, n * 255, n * 255]
    let i = [0, 0, 0],
      o = (t % 1) * 6,
      s = o % 1,
      l = 1 - s,
      u = 0
    switch (Math.floor(o)) {
      case 0:
        ;(i[0] = 1), (i[1] = s), (i[2] = 0)
        break
      case 1:
        ;(i[0] = l), (i[1] = 1), (i[2] = 0)
        break
      case 2:
        ;(i[0] = 0), (i[1] = 1), (i[2] = s)
        break
      case 3:
        ;(i[0] = 0), (i[1] = l), (i[2] = 1)
        break
      case 4:
        ;(i[0] = s), (i[1] = 0), (i[2] = 1)
        break
      default:
        ;(i[0] = 1), (i[1] = 0), (i[2] = l)
    }
    return (
      (u = (1 - r) * n),
      [(r * i[0] + u) * 255, (r * i[1] + u) * 255, (r * i[2] + u) * 255]
    )
  }
  P.hcg.hsv = function (e) {
    let t = e[1] / 100,
      r = e[2] / 100,
      n = t + r * (1 - t),
      i = 0
    return n > 0 && (i = t / n), [e[0], i * 100, n * 100]
  }
  P.hcg.hsl = function (e) {
    let t = e[1] / 100,
      n = (e[2] / 100) * (1 - t) + 0.5 * t,
      i = 0
    return (
      n > 0 && n < 0.5
        ? (i = t / (2 * n))
        : n >= 0.5 && n < 1 && (i = t / (2 * (1 - n))),
      [e[0], i * 100, n * 100]
    )
  }
  P.hcg.hwb = function (e) {
    let t = e[1] / 100,
      r = e[2] / 100,
      n = t + r * (1 - t)
    return [e[0], (n - t) * 100, (1 - n) * 100]
  }
  P.hwb.hcg = function (e) {
    let t = e[1] / 100,
      n = 1 - e[2] / 100,
      i = n - t,
      o = 0
    return i < 1 && (o = (n - i) / (1 - i)), [e[0], i * 100, o * 100]
  }
  P.apple.rgb = function (e) {
    return [(e[0] / 65535) * 255, (e[1] / 65535) * 255, (e[2] / 65535) * 255]
  }
  P.rgb.apple = function (e) {
    return [(e[0] / 255) * 65535, (e[1] / 255) * 65535, (e[2] / 255) * 65535]
  }
  P.gray.rgb = function (e) {
    return [(e[0] / 100) * 255, (e[0] / 100) * 255, (e[0] / 100) * 255]
  }
  P.gray.hsl = function (e) {
    return [0, 0, e[0]]
  }
  P.gray.hsv = P.gray.hsl
  P.gray.hwb = function (e) {
    return [0, 100, e[0]]
  }
  P.gray.cmyk = function (e) {
    return [0, 0, 0, e[0]]
  }
  P.gray.lab = function (e) {
    return [e[0], 0, 0]
  }
  P.gray.hex = function (e) {
    let t = Math.round((e[0] / 100) * 255) & 255,
      n = ((t << 16) + (t << 8) + t).toString(16).toUpperCase()
    return '000000'.substring(n.length) + n
  }
  P.rgb.gray = function (e) {
    return [((e[0] + e[1] + e[2]) / 3 / 255) * 100]
  }
})
var Ps = F((yy, Ss) => {
  var yn = ji()
  function fp() {
    let e = {},
      t = Object.keys(yn)
    for (let r = t.length, n = 0; n < r; n++)
      e[t[n]] = { distance: -1, parent: null }
    return e
  }
  a(fp, 'buildGraph')
  function dp(e) {
    let t = fp(),
      r = [e]
    for (t[e].distance = 0; r.length; ) {
      let n = r.pop(),
        i = Object.keys(yn[n])
      for (let o = i.length, s = 0; s < o; s++) {
        let l = i[s],
          u = t[l]
        u.distance === -1 &&
          ((u.distance = t[n].distance + 1), (u.parent = n), r.unshift(l))
      }
    }
    return t
  }
  a(dp, 'deriveBFS')
  function mp(e, t) {
    return function (r) {
      return t(e(r))
    }
  }
  a(mp, 'link')
  function gp(e, t) {
    let r = [t[e].parent, e],
      n = yn[t[e].parent][e],
      i = t[e].parent
    for (; t[i].parent; )
      r.unshift(t[i].parent), (n = mp(yn[t[i].parent][i], n)), (i = t[i].parent)
    return (n.conversion = r), n
  }
  a(gp, 'wrapConversion')
  Ss.exports = function (e) {
    let t = dp(e),
      r = {},
      n = Object.keys(t)
    for (let i = n.length, o = 0; o < i; o++) {
      let s = n[o]
      t[s].parent !== null && (r[s] = gp(s, t))
    }
    return r
  }
})
var Cs = F((Ey, _s) => {
  var Bi = ji(),
    hp = Ps(),
    St = {},
    yp = Object.keys(Bi)
  function bp(e) {
    let t = a(function (...r) {
      let n = r[0]
      return n == null ? n : (n.length > 1 && (r = n), e(r))
    }, 'wrappedFn')
    return 'conversion' in e && (t.conversion = e.conversion), t
  }
  a(bp, 'wrapRaw')
  function Ep(e) {
    let t = a(function (...r) {
      let n = r[0]
      if (n == null) return n
      n.length > 1 && (r = n)
      let i = e(r)
      if (typeof i == 'object')
        for (let o = i.length, s = 0; s < o; s++) i[s] = Math.round(i[s])
      return i
    }, 'wrappedFn')
    return 'conversion' in e && (t.conversion = e.conversion), t
  }
  a(Ep, 'wrapRounded')
  yp.forEach((e) => {
    ;(St[e] = {}),
      Object.defineProperty(St[e], 'channels', { value: Bi[e].channels }),
      Object.defineProperty(St[e], 'labels', { value: Bi[e].labels })
    let t = hp(e)
    Object.keys(t).forEach((n) => {
      let i = t[n]
      ;(St[e][n] = Ep(i)), (St[e][n].raw = bp(i))
    })
  })
  _s.exports = St
})
var Is = F((xy, Fs) => {
  'use strict'
  var Os = a(
      (e, t) =>
        (...r) =>
          `\x1B[${e(...r) + t}m`,
      'wrapAnsi16'
    ),
    Ms = a(
      (e, t) =>
        (...r) => {
          let n = e(...r)
          return `\x1B[${38 + t};5;${n}m`
        },
      'wrapAnsi256'
    ),
    Ns = a(
      (e, t) =>
        (...r) => {
          let n = e(...r)
          return `\x1B[${38 + t};2;${n[0]};${n[1]};${n[2]}m`
        },
      'wrapAnsi16m'
    ),
    bn = a((e) => e, 'ansi2ansi'),
    Rs = a((e, t, r) => [e, t, r], 'rgb2rgb'),
    Pt = a((e, t, r) => {
      Object.defineProperty(e, t, {
        get: () => {
          let n = r()
          return (
            Object.defineProperty(e, t, {
              value: n,
              enumerable: !0,
              configurable: !0,
            }),
            n
          )
        },
        enumerable: !0,
        configurable: !0,
      })
    }, 'setLazyProperty'),
    qi,
    _t = a((e, t, r, n) => {
      qi === void 0 && (qi = Cs())
      let i = n ? 10 : 0,
        o = {}
      for (let [s, l] of Object.entries(qi)) {
        let u = s === 'ansi16' ? 'ansi' : s
        s === t ? (o[u] = e(r, i)) : typeof l == 'object' && (o[u] = e(l[t], i))
      }
      return o
    }, 'makeDynamicStyles')
  function wp() {
    let e = new Map(),
      t = {
        modifier: {
          reset: [0, 0],
          bold: [1, 22],
          dim: [2, 22],
          italic: [3, 23],
          underline: [4, 24],
          inverse: [7, 27],
          hidden: [8, 28],
          strikethrough: [9, 29],
        },
        color: {
          black: [30, 39],
          red: [31, 39],
          green: [32, 39],
          yellow: [33, 39],
          blue: [34, 39],
          magenta: [35, 39],
          cyan: [36, 39],
          white: [37, 39],
          blackBright: [90, 39],
          redBright: [91, 39],
          greenBright: [92, 39],
          yellowBright: [93, 39],
          blueBright: [94, 39],
          magentaBright: [95, 39],
          cyanBright: [96, 39],
          whiteBright: [97, 39],
        },
        bgColor: {
          bgBlack: [40, 49],
          bgRed: [41, 49],
          bgGreen: [42, 49],
          bgYellow: [43, 49],
          bgBlue: [44, 49],
          bgMagenta: [45, 49],
          bgCyan: [46, 49],
          bgWhite: [47, 49],
          bgBlackBright: [100, 49],
          bgRedBright: [101, 49],
          bgGreenBright: [102, 49],
          bgYellowBright: [103, 49],
          bgBlueBright: [104, 49],
          bgMagentaBright: [105, 49],
          bgCyanBright: [106, 49],
          bgWhiteBright: [107, 49],
        },
      }
    ;(t.color.gray = t.color.blackBright),
      (t.bgColor.bgGray = t.bgColor.bgBlackBright),
      (t.color.grey = t.color.blackBright),
      (t.bgColor.bgGrey = t.bgColor.bgBlackBright)
    for (let [r, n] of Object.entries(t)) {
      for (let [i, o] of Object.entries(n))
        (t[i] = { open: `\x1B[${o[0]}m`, close: `\x1B[${o[1]}m` }),
          (n[i] = t[i]),
          e.set(o[0], o[1])
      Object.defineProperty(t, r, { value: n, enumerable: !1 })
    }
    return (
      Object.defineProperty(t, 'codes', { value: e, enumerable: !1 }),
      (t.color.close = '\x1B[39m'),
      (t.bgColor.close = '\x1B[49m'),
      Pt(t.color, 'ansi', () => _t(Os, 'ansi16', bn, !1)),
      Pt(t.color, 'ansi256', () => _t(Ms, 'ansi256', bn, !1)),
      Pt(t.color, 'ansi16m', () => _t(Ns, 'rgb', Rs, !1)),
      Pt(t.bgColor, 'ansi', () => _t(Os, 'ansi16', bn, !0)),
      Pt(t.bgColor, 'ansi256', () => _t(Ms, 'ansi256', bn, !0)),
      Pt(t.bgColor, 'ansi16m', () => _t(Ns, 'rgb', Rs, !0)),
      t
    )
  }
  a(wp, 'assembleStyles')
  Object.defineProperty(Fs, 'exports', { enumerable: !0, get: wp })
})
var Vi = F((Ty, Ds) => {
  'use strict'
  Ds.exports = (e, t = process.argv) => {
    let r = e.startsWith('-') ? '' : e.length === 1 ? '-' : '--',
      n = t.indexOf(r + e),
      i = t.indexOf('--')
    return n !== -1 && (i === -1 || n < i)
  }
})
var En = F((Ay, $s) => {
  'use strict'
  var xp = require('os'),
    ks = require('tty'),
    ve = Vi(),
    { env: W } = process,
    We
  ve('no-color') || ve('no-colors') || ve('color=false') || ve('color=never')
    ? (We = 0)
    : (ve('color') || ve('colors') || ve('color=true') || ve('color=always')) &&
      (We = 1)
  'FORCE_COLOR' in W &&
    (W.FORCE_COLOR === 'true'
      ? (We = 1)
      : W.FORCE_COLOR === 'false'
      ? (We = 0)
      : (We =
          W.FORCE_COLOR.length === 0
            ? 1
            : Math.min(parseInt(W.FORCE_COLOR, 10), 3)))
  function Ui(e) {
    return e === 0
      ? !1
      : { level: e, hasBasic: !0, has256: e >= 2, has16m: e >= 3 }
  }
  a(Ui, 'translateLevel')
  function Gi(e, t) {
    if (We === 0) return 0
    if (ve('color=16m') || ve('color=full') || ve('color=truecolor')) return 3
    if (ve('color=256')) return 2
    if (e && !t && We === void 0) return 0
    let r = We || 0
    if (W.TERM === 'dumb') return r
    if (process.platform === 'win32') {
      let n = xp.release().split('.')
      return Number(n[0]) >= 10 && Number(n[2]) >= 10586
        ? Number(n[2]) >= 14931
          ? 3
          : 2
        : 1
    }
    if ('CI' in W)
      return [
        'TRAVIS',
        'CIRCLECI',
        'APPVEYOR',
        'GITLAB_CI',
        'GITHUB_ACTIONS',
        'BUILDKITE',
      ].some((n) => n in W) || W.CI_NAME === 'codeship'
        ? 1
        : r
    if ('TEAMCITY_VERSION' in W)
      return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(W.TEAMCITY_VERSION) ? 1 : 0
    if (W.COLORTERM === 'truecolor') return 3
    if ('TERM_PROGRAM' in W) {
      let n = parseInt((W.TERM_PROGRAM_VERSION || '').split('.')[0], 10)
      switch (W.TERM_PROGRAM) {
        case 'iTerm.app':
          return n >= 3 ? 3 : 2
        case 'Apple_Terminal':
          return 2
      }
    }
    return /-256(color)?$/i.test(W.TERM)
      ? 2
      : /^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(
          W.TERM
        ) || 'COLORTERM' in W
      ? 1
      : r
  }
  a(Gi, 'supportsColor')
  function vp(e) {
    let t = Gi(e, e && e.isTTY)
    return Ui(t)
  }
  a(vp, 'getSupportLevel')
  $s.exports = {
    supportsColor: vp,
    stdout: Ui(Gi(!0, ks.isatty(1))),
    stderr: Ui(Gi(!0, ks.isatty(2))),
  }
})
var js = F((Py, Ls) => {
  'use strict'
  var Tp = a((e, t, r) => {
      let n = e.indexOf(t)
      if (n === -1) return e
      let i = t.length,
        o = 0,
        s = ''
      do (s += e.substr(o, n - o) + t + r), (o = n + i), (n = e.indexOf(t, o))
      while (n !== -1)
      return (s += e.substr(o)), s
    }, 'stringReplaceAll'),
    Ap = a((e, t, r, n) => {
      let i = 0,
        o = ''
      do {
        let s = e[n - 1] === '\r'
        ;(o +=
          e.substr(i, (s ? n - 1 : n) - i) +
          t +
          (s
            ? `\r
`
            : `
`) +
          r),
          (i = n + 1),
          (n = e.indexOf(
            `
`,
            i
          ))
      } while (n !== -1)
      return (o += e.substr(i)), o
    }, 'stringEncaseCRLFWithFirstIndex')
  Ls.exports = { stringReplaceAll: Tp, stringEncaseCRLFWithFirstIndex: Ap }
})
var Gs = F((Cy, Us) => {
  'use strict'
  var Sp =
      /(?:\\(u(?:[a-f\d]{4}|\{[a-f\d]{1,6}\})|x[a-f\d]{2}|.))|(?:\{(~)?(\w+(?:\([^)]*\))?(?:\.\w+(?:\([^)]*\))?)*)(?:[ \t]|(?=\r?\n)))|(\})|((?:.|[\r\n\f])+?)/gi,
    Bs = /(?:^|\.)(\w+)(?:\(([^)]*)\))?/g,
    Pp = /^(['"])((?:\\.|(?!\1)[^\\])*)\1$/,
    _p = /\\(u(?:[a-f\d]{4}|{[a-f\d]{1,6}})|x[a-f\d]{2}|.)|([^\\])/gi,
    Cp = new Map([
      [
        'n',
        `
`,
      ],
      ['r', '\r'],
      ['t', '	'],
      ['b', '\b'],
      ['f', '\f'],
      ['v', '\v'],
      ['0', '\0'],
      ['\\', '\\'],
      ['e', '\x1B'],
      ['a', '\x07'],
    ])
  function Vs(e) {
    let t = e[0] === 'u',
      r = e[1] === '{'
    return (t && !r && e.length === 5) || (e[0] === 'x' && e.length === 3)
      ? String.fromCharCode(parseInt(e.slice(1), 16))
      : t && r
      ? String.fromCodePoint(parseInt(e.slice(2, -1), 16))
      : Cp.get(e) || e
  }
  a(Vs, 'unescape')
  function Op(e, t) {
    let r = [],
      n = t.trim().split(/\s*,\s*/g),
      i
    for (let o of n) {
      let s = Number(o)
      if (!Number.isNaN(s)) r.push(s)
      else if ((i = o.match(Pp)))
        r.push(i[2].replace(_p, (l, u, c) => (u ? Vs(u) : c)))
      else
        throw new Error(
          `Invalid Chalk template style argument: ${o} (in style '${e}')`
        )
    }
    return r
  }
  a(Op, 'parseArguments')
  function Mp(e) {
    Bs.lastIndex = 0
    let t = [],
      r
    for (; (r = Bs.exec(e)) !== null; ) {
      let n = r[1]
      if (r[2]) {
        let i = Op(n, r[2])
        t.push([n].concat(i))
      } else t.push([n])
    }
    return t
  }
  a(Mp, 'parseStyle')
  function qs(e, t) {
    let r = {}
    for (let i of t)
      for (let o of i.styles) r[o[0]] = i.inverse ? null : o.slice(1)
    let n = e
    for (let [i, o] of Object.entries(r))
      if (!!Array.isArray(o)) {
        if (!(i in n)) throw new Error(`Unknown Chalk style: ${i}`)
        n = o.length > 0 ? n[i](...o) : n[i]
      }
    return n
  }
  a(qs, 'buildStyle')
  Us.exports = (e, t) => {
    let r = [],
      n = [],
      i = []
    if (
      (t.replace(Sp, (o, s, l, u, c, p) => {
        if (s) i.push(Vs(s))
        else if (u) {
          let f = i.join('')
          ;(i = []),
            n.push(r.length === 0 ? f : qs(e, r)(f)),
            r.push({ inverse: l, styles: Mp(u) })
        } else if (c) {
          if (r.length === 0)
            throw new Error('Found extraneous } in Chalk template literal')
          n.push(qs(e, r)(i.join(''))), (i = []), r.pop()
        } else i.push(p)
      }),
      n.push(i.join('')),
      r.length > 0)
    ) {
      let o = `Chalk template literal is missing ${r.length} closing bracket${
        r.length === 1 ? '' : 's'
      } (\`}\`)`
      throw new Error(o)
    }
    return n.join('')
  }
})
var ae = F((My, Ys) => {
  'use strict'
  var cr = Is(),
    { stdout: Ki, stderr: Wi } = En(),
    { stringReplaceAll: Np, stringEncaseCRLFWithFirstIndex: Rp } = js(),
    { isArray: xn } = Array,
    Ks = ['ansi', 'ansi', 'ansi256', 'ansi16m'],
    Ct = Object.create(null),
    Fp = a((e, t = {}) => {
      if (
        t.level &&
        !(Number.isInteger(t.level) && t.level >= 0 && t.level <= 3)
      )
        throw new Error('The `level` option should be an integer from 0 to 3')
      let r = Ki ? Ki.level : 0
      e.level = t.level === void 0 ? r : t.level
    }, 'applyOptions'),
    wn = class {
      constructor(t) {
        return Ws(t)
      }
    }
  a(wn, 'ChalkClass')
  var Ws = a((e) => {
    let t = {}
    return (
      Fp(t, e),
      (t.template = (...r) => Hs(t.template, ...r)),
      Object.setPrototypeOf(t, vn.prototype),
      Object.setPrototypeOf(t.template, t),
      (t.template.constructor = () => {
        throw new Error(
          '`chalk.constructor()` is deprecated. Use `new chalk.Instance()` instead.'
        )
      }),
      (t.template.Instance = wn),
      t.template
    )
  }, 'chalkFactory')
  function vn(e) {
    return Ws(e)
  }
  a(vn, 'Chalk')
  for (let [e, t] of Object.entries(cr))
    Ct[e] = {
      get() {
        let r = Tn(this, Ji(t.open, t.close, this._styler), this._isEmpty)
        return Object.defineProperty(this, e, { value: r }), r
      },
    }
  Ct.visible = {
    get() {
      let e = Tn(this, this._styler, !0)
      return Object.defineProperty(this, 'visible', { value: e }), e
    },
  }
  var Js = ['rgb', 'hex', 'keyword', 'hsl', 'hsv', 'hwb', 'ansi', 'ansi256']
  for (let e of Js)
    Ct[e] = {
      get() {
        let { level: t } = this
        return function (...r) {
          let n = Ji(cr.color[Ks[t]][e](...r), cr.color.close, this._styler)
          return Tn(this, n, this._isEmpty)
        }
      },
    }
  for (let e of Js) {
    let t = 'bg' + e[0].toUpperCase() + e.slice(1)
    Ct[t] = {
      get() {
        let { level: r } = this
        return function (...n) {
          let i = Ji(cr.bgColor[Ks[r]][e](...n), cr.bgColor.close, this._styler)
          return Tn(this, i, this._isEmpty)
        }
      },
    }
  }
  var Ip = Object.defineProperties(() => {}, {
      ...Ct,
      level: {
        enumerable: !0,
        get() {
          return this._generator.level
        },
        set(e) {
          this._generator.level = e
        },
      },
    }),
    Ji = a((e, t, r) => {
      let n, i
      return (
        r === void 0
          ? ((n = e), (i = t))
          : ((n = r.openAll + e), (i = t + r.closeAll)),
        { open: e, close: t, openAll: n, closeAll: i, parent: r }
      )
    }, 'createStyler'),
    Tn = a((e, t, r) => {
      let n = a(
        (...i) =>
          xn(i[0]) && xn(i[0].raw)
            ? Qs(n, Hs(n, ...i))
            : Qs(n, i.length === 1 ? '' + i[0] : i.join(' ')),
        'builder'
      )
      return (
        Object.setPrototypeOf(n, Ip),
        (n._generator = e),
        (n._styler = t),
        (n._isEmpty = r),
        n
      )
    }, 'createBuilder'),
    Qs = a((e, t) => {
      if (e.level <= 0 || !t) return e._isEmpty ? '' : t
      let r = e._styler
      if (r === void 0) return t
      let { openAll: n, closeAll: i } = r
      if (t.indexOf('\x1B') !== -1)
        for (; r !== void 0; ) (t = Np(t, r.close, r.open)), (r = r.parent)
      let o = t.indexOf(`
`)
      return o !== -1 && (t = Rp(t, i, n, o)), n + t + i
    }, 'applyStyle'),
    Qi,
    Hs = a((e, ...t) => {
      let [r] = t
      if (!xn(r) || !xn(r.raw)) return t.join(' ')
      let n = t.slice(1),
        i = [r.raw[0]]
      for (let o = 1; o < r.length; o++)
        i.push(String(n[o - 1]).replace(/[{}\\]/g, '\\$&'), String(r.raw[o]))
      return Qi === void 0 && (Qi = Gs()), Qi(e, i.join(''))
    }, 'chalkTag')
  Object.defineProperties(vn.prototype, Ct)
  var An = vn()
  An.supportsColor = Ki
  An.stderr = vn({ level: Wi ? Wi.level : 0 })
  An.stderr.supportsColor = Wi
  Ys.exports = An
})
var fr = F((Iy, pa) => {
  'use strict'
  pa.exports = (e, t = 1, r) => {
    if (
      ((r = { indent: ' ', includeEmptyLines: !1, ...r }), typeof e != 'string')
    )
      throw new TypeError(
        `Expected \`input\` to be a \`string\`, got \`${typeof e}\``
      )
    if (typeof t != 'number')
      throw new TypeError(
        `Expected \`count\` to be a \`number\`, got \`${typeof t}\``
      )
    if (typeof r.indent != 'string')
      throw new TypeError(
        `Expected \`options.indent\` to be a \`string\`, got \`${typeof r.indent}\``
      )
    if (t === 0) return e
    let n = r.includeEmptyLines ? /^/gm : /^(?!\s*$)/gm
    return e.replace(n, r.indent.repeat(t))
  }
})
var Rn = F((Dy, fa) => {
  'use strict'
  fa.exports = (function () {
    function e(t, r, n, i, o) {
      return t < r || n < r ? (t > n ? n + 1 : t + 1) : i === o ? r : r + 1
    }
    return (
      a(e, '_min'),
      function (t, r) {
        if (t === r) return 0
        if (t.length > r.length) {
          var n = t
          ;(t = r), (r = n)
        }
        for (
          var i = t.length, o = r.length;
          i > 0 && t.charCodeAt(i - 1) === r.charCodeAt(o - 1);

        )
          i--, o--
        for (var s = 0; s < i && t.charCodeAt(s) === r.charCodeAt(s); ) s++
        if (((i -= s), (o -= s), i === 0 || o < 3)) return o
        var l = 0,
          u,
          c,
          p,
          f,
          d,
          m,
          h,
          g,
          b,
          y,
          x,
          E,
          w = []
        for (u = 0; u < i; u++) w.push(u + 1), w.push(t.charCodeAt(s + u))
        for (var T = w.length - 1; l < o - 3; )
          for (
            b = r.charCodeAt(s + (c = l)),
              y = r.charCodeAt(s + (p = l + 1)),
              x = r.charCodeAt(s + (f = l + 2)),
              E = r.charCodeAt(s + (d = l + 3)),
              m = l += 4,
              u = 0;
            u < T;
            u += 2
          )
            (h = w[u]),
              (g = w[u + 1]),
              (c = e(h, c, p, b, g)),
              (p = e(c, p, f, y, g)),
              (f = e(p, f, d, x, g)),
              (m = e(f, d, m, E, g)),
              (w[u] = m),
              (d = f),
              (f = p),
              (p = c),
              (c = h)
        for (; l < o; )
          for (b = r.charCodeAt(s + (c = l)), m = ++l, u = 0; u < T; u += 2)
            (h = w[u]), (w[u] = m = e(h, c, m, b, w[u + 1])), (c = h)
        return m
      }
    )
  })()
})
var ba = F((t0, ya) => {
  var Lt = 1e3,
    jt = Lt * 60,
    Bt = jt * 60,
    ht = Bt * 24,
    Df = ht * 7,
    kf = ht * 365.25
  ya.exports = function (e, t) {
    t = t || {}
    var r = typeof e
    if (r === 'string' && e.length > 0) return $f(e)
    if (r === 'number' && isFinite(e)) return t.long ? jf(e) : Lf(e)
    throw new Error(
      'val is not a non-empty string or a valid number. val=' +
        JSON.stringify(e)
    )
  }
  function $f(e) {
    if (((e = String(e)), !(e.length > 100))) {
      var t =
        /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
          e
        )
      if (!!t) {
        var r = parseFloat(t[1]),
          n = (t[2] || 'ms').toLowerCase()
        switch (n) {
          case 'years':
          case 'year':
          case 'yrs':
          case 'yr':
          case 'y':
            return r * kf
          case 'weeks':
          case 'week':
          case 'w':
            return r * Df
          case 'days':
          case 'day':
          case 'd':
            return r * ht
          case 'hours':
          case 'hour':
          case 'hrs':
          case 'hr':
          case 'h':
            return r * Bt
          case 'minutes':
          case 'minute':
          case 'mins':
          case 'min':
          case 'm':
            return r * jt
          case 'seconds':
          case 'second':
          case 'secs':
          case 'sec':
          case 's':
            return r * Lt
          case 'milliseconds':
          case 'millisecond':
          case 'msecs':
          case 'msec':
          case 'ms':
            return r
          default:
            return
        }
      }
    }
  }
  a($f, 'parse')
  function Lf(e) {
    var t = Math.abs(e)
    return t >= ht
      ? Math.round(e / ht) + 'd'
      : t >= Bt
      ? Math.round(e / Bt) + 'h'
      : t >= jt
      ? Math.round(e / jt) + 'm'
      : t >= Lt
      ? Math.round(e / Lt) + 's'
      : e + 'ms'
  }
  a(Lf, 'fmtShort')
  function jf(e) {
    var t = Math.abs(e)
    return t >= ht
      ? kn(e, t, ht, 'day')
      : t >= Bt
      ? kn(e, t, Bt, 'hour')
      : t >= jt
      ? kn(e, t, jt, 'minute')
      : t >= Lt
      ? kn(e, t, Lt, 'second')
      : e + ' ms'
  }
  a(jf, 'fmtLong')
  function kn(e, t, r, n) {
    var i = t >= r * 1.5
    return Math.round(e / r) + ' ' + n + (i ? 's' : '')
  }
  a(kn, 'plural')
})
var io = F((n0, Ea) => {
  function Bf(e) {
    ;(r.debug = r),
      (r.default = r),
      (r.coerce = u),
      (r.disable = o),
      (r.enable = i),
      (r.enabled = s),
      (r.humanize = ba()),
      (r.destroy = c),
      Object.keys(e).forEach((p) => {
        r[p] = e[p]
      }),
      (r.names = []),
      (r.skips = []),
      (r.formatters = {})
    function t(p) {
      let f = 0
      for (let d = 0; d < p.length; d++)
        (f = (f << 5) - f + p.charCodeAt(d)), (f |= 0)
      return r.colors[Math.abs(f) % r.colors.length]
    }
    a(t, 'selectColor'), (r.selectColor = t)
    function r(p) {
      let f,
        d = null,
        m,
        h
      function g(...b) {
        if (!g.enabled) return
        let y = g,
          x = Number(new Date()),
          E = x - (f || x)
        ;(y.diff = E),
          (y.prev = f),
          (y.curr = x),
          (f = x),
          (b[0] = r.coerce(b[0])),
          typeof b[0] != 'string' && b.unshift('%O')
        let w = 0
        ;(b[0] = b[0].replace(/%([a-zA-Z%])/g, (C, S) => {
          if (C === '%%') return '%'
          w++
          let D = r.formatters[S]
          if (typeof D == 'function') {
            let q = b[w]
            ;(C = D.call(y, q)), b.splice(w, 1), w--
          }
          return C
        })),
          r.formatArgs.call(y, b),
          (y.log || r.log).apply(y, b)
      }
      return (
        a(g, 'debug'),
        (g.namespace = p),
        (g.useColors = r.useColors()),
        (g.color = r.selectColor(p)),
        (g.extend = n),
        (g.destroy = r.destroy),
        Object.defineProperty(g, 'enabled', {
          enumerable: !0,
          configurable: !1,
          get: () =>
            d !== null
              ? d
              : (m !== r.namespaces && ((m = r.namespaces), (h = r.enabled(p))),
                h),
          set: (b) => {
            d = b
          },
        }),
        typeof r.init == 'function' && r.init(g),
        g
      )
    }
    a(r, 'createDebug')
    function n(p, f) {
      let d = r(this.namespace + (typeof f > 'u' ? ':' : f) + p)
      return (d.log = this.log), d
    }
    a(n, 'extend')
    function i(p) {
      r.save(p), (r.namespaces = p), (r.names = []), (r.skips = [])
      let f,
        d = (typeof p == 'string' ? p : '').split(/[\s,]+/),
        m = d.length
      for (f = 0; f < m; f++)
        !d[f] ||
          ((p = d[f].replace(/\*/g, '.*?')),
          p[0] === '-'
            ? r.skips.push(new RegExp('^' + p.slice(1) + '$'))
            : r.names.push(new RegExp('^' + p + '$')))
    }
    a(i, 'enable')
    function o() {
      let p = [...r.names.map(l), ...r.skips.map(l).map((f) => '-' + f)].join(
        ','
      )
      return r.enable(''), p
    }
    a(o, 'disable')
    function s(p) {
      if (p[p.length - 1] === '*') return !0
      let f, d
      for (f = 0, d = r.skips.length; f < d; f++)
        if (r.skips[f].test(p)) return !1
      for (f = 0, d = r.names.length; f < d; f++)
        if (r.names[f].test(p)) return !0
      return !1
    }
    a(s, 'enabled')
    function l(p) {
      return p
        .toString()
        .substring(2, p.toString().length - 2)
        .replace(/\.\*\?$/, '*')
    }
    a(l, 'toNamespace')
    function u(p) {
      return p instanceof Error ? p.stack || p.message : p
    }
    a(u, 'coerce')
    function c() {
      console.warn(
        'Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.'
      )
    }
    return a(c, 'destroy'), r.enable(r.load()), r
  }
  a(Bf, 'setup')
  Ea.exports = Bf
})
var wa = F((Ee, $n) => {
  Ee.formatArgs = Vf
  Ee.save = Uf
  Ee.load = Gf
  Ee.useColors = qf
  Ee.storage = Qf()
  Ee.destroy = (() => {
    let e = !1
    return () => {
      e ||
        ((e = !0),
        console.warn(
          'Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.'
        ))
    }
  })()
  Ee.colors = [
    '#0000CC',
    '#0000FF',
    '#0033CC',
    '#0033FF',
    '#0066CC',
    '#0066FF',
    '#0099CC',
    '#0099FF',
    '#00CC00',
    '#00CC33',
    '#00CC66',
    '#00CC99',
    '#00CCCC',
    '#00CCFF',
    '#3300CC',
    '#3300FF',
    '#3333CC',
    '#3333FF',
    '#3366CC',
    '#3366FF',
    '#3399CC',
    '#3399FF',
    '#33CC00',
    '#33CC33',
    '#33CC66',
    '#33CC99',
    '#33CCCC',
    '#33CCFF',
    '#6600CC',
    '#6600FF',
    '#6633CC',
    '#6633FF',
    '#66CC00',
    '#66CC33',
    '#9900CC',
    '#9900FF',
    '#9933CC',
    '#9933FF',
    '#99CC00',
    '#99CC33',
    '#CC0000',
    '#CC0033',
    '#CC0066',
    '#CC0099',
    '#CC00CC',
    '#CC00FF',
    '#CC3300',
    '#CC3333',
    '#CC3366',
    '#CC3399',
    '#CC33CC',
    '#CC33FF',
    '#CC6600',
    '#CC6633',
    '#CC9900',
    '#CC9933',
    '#CCCC00',
    '#CCCC33',
    '#FF0000',
    '#FF0033',
    '#FF0066',
    '#FF0099',
    '#FF00CC',
    '#FF00FF',
    '#FF3300',
    '#FF3333',
    '#FF3366',
    '#FF3399',
    '#FF33CC',
    '#FF33FF',
    '#FF6600',
    '#FF6633',
    '#FF9900',
    '#FF9933',
    '#FFCC00',
    '#FFCC33',
  ]
  function qf() {
    return typeof window < 'u' &&
      window.process &&
      (window.process.type === 'renderer' || window.process.__nwjs)
      ? !0
      : typeof navigator < 'u' &&
        navigator.userAgent &&
        navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)
      ? !1
      : (typeof document < 'u' &&
          document.documentElement &&
          document.documentElement.style &&
          document.documentElement.style.WebkitAppearance) ||
        (typeof window < 'u' &&
          window.console &&
          (window.console.firebug ||
            (window.console.exception && window.console.table))) ||
        (typeof navigator < 'u' &&
          navigator.userAgent &&
          navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) &&
          parseInt(RegExp.$1, 10) >= 31) ||
        (typeof navigator < 'u' &&
          navigator.userAgent &&
          navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/))
  }
  a(qf, 'useColors')
  function Vf(e) {
    if (
      ((e[0] =
        (this.useColors ? '%c' : '') +
        this.namespace +
        (this.useColors ? ' %c' : ' ') +
        e[0] +
        (this.useColors ? '%c ' : ' ') +
        '+' +
        $n.exports.humanize(this.diff)),
      !this.useColors)
    )
      return
    let t = 'color: ' + this.color
    e.splice(1, 0, t, 'color: inherit')
    let r = 0,
      n = 0
    e[0].replace(/%[a-zA-Z%]/g, (i) => {
      i !== '%%' && (r++, i === '%c' && (n = r))
    }),
      e.splice(n, 0, t)
  }
  a(Vf, 'formatArgs')
  Ee.log = console.debug || console.log || (() => {})
  function Uf(e) {
    try {
      e ? Ee.storage.setItem('debug', e) : Ee.storage.removeItem('debug')
    } catch {}
  }
  a(Uf, 'save')
  function Gf() {
    let e
    try {
      e = Ee.storage.getItem('debug')
    } catch {}
    return (
      !e && typeof process < 'u' && 'env' in process && (e = process.env.DEBUG),
      e
    )
  }
  a(Gf, 'load')
  function Qf() {
    try {
      return localStorage
    } catch {}
  }
  a(Qf, 'localstorage')
  $n.exports = io()(Ee)
  var { formatters: Kf } = $n.exports
  Kf.j = function (e) {
    try {
      return JSON.stringify(e)
    } catch (t) {
      return '[UnexpectedJSONParseError]: ' + t.message
    }
  }
})
var va = F((z, jn) => {
  var Wf = require('tty'),
    Ln = require('util')
  z.init = ed
  z.log = zf
  z.formatArgs = Hf
  z.save = Xf
  z.load = Zf
  z.useColors = Jf
  z.destroy = Ln.deprecate(() => {},
  'Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.')
  z.colors = [6, 2, 3, 4, 5, 1]
  try {
    let e = En()
    e &&
      (e.stderr || e).level >= 2 &&
      (z.colors = [
        20, 21, 26, 27, 32, 33, 38, 39, 40, 41, 42, 43, 44, 45, 56, 57, 62, 63,
        68, 69, 74, 75, 76, 77, 78, 79, 80, 81, 92, 93, 98, 99, 112, 113, 128,
        129, 134, 135, 148, 149, 160, 161, 162, 163, 164, 165, 166, 167, 168,
        169, 170, 171, 172, 173, 178, 179, 184, 185, 196, 197, 198, 199, 200,
        201, 202, 203, 204, 205, 206, 207, 208, 209, 214, 215, 220, 221,
      ])
  } catch {}
  z.inspectOpts = Object.keys(process.env)
    .filter((e) => /^debug_/i.test(e))
    .reduce((e, t) => {
      let r = t
          .substring(6)
          .toLowerCase()
          .replace(/_([a-z])/g, (i, o) => o.toUpperCase()),
        n = process.env[t]
      return (
        /^(yes|on|true|enabled)$/i.test(n)
          ? (n = !0)
          : /^(no|off|false|disabled)$/i.test(n)
          ? (n = !1)
          : n === 'null'
          ? (n = null)
          : (n = Number(n)),
        (e[r] = n),
        e
      )
    }, {})
  function Jf() {
    return 'colors' in z.inspectOpts
      ? Boolean(z.inspectOpts.colors)
      : Wf.isatty(process.stderr.fd)
  }
  a(Jf, 'useColors')
  function Hf(e) {
    let { namespace: t, useColors: r } = this
    if (r) {
      let n = this.color,
        i = '\x1B[3' + (n < 8 ? n : '8;5;' + n),
        o = `  ${i};1m${t} \x1B[0m`
      ;(e[0] =
        o +
        e[0]
          .split(
            `
`
          )
          .join(
            `
` + o
          )),
        e.push(i + 'm+' + jn.exports.humanize(this.diff) + '\x1B[0m')
    } else e[0] = Yf() + t + ' ' + e[0]
  }
  a(Hf, 'formatArgs')
  function Yf() {
    return z.inspectOpts.hideDate ? '' : new Date().toISOString() + ' '
  }
  a(Yf, 'getDate')
  function zf(...e) {
    return process.stderr.write(
      Ln.format(...e) +
        `
`
    )
  }
  a(zf, 'log')
  function Xf(e) {
    e ? (process.env.DEBUG = e) : delete process.env.DEBUG
  }
  a(Xf, 'save')
  function Zf() {
    return process.env.DEBUG
  }
  a(Zf, 'load')
  function ed(e) {
    e.inspectOpts = {}
    let t = Object.keys(z.inspectOpts)
    for (let r = 0; r < t.length; r++) e.inspectOpts[t[r]] = z.inspectOpts[t[r]]
  }
  a(ed, 'init')
  jn.exports = io()(z)
  var { formatters: xa } = jn.exports
  xa.o = function (e) {
    return (
      (this.inspectOpts.colors = this.useColors),
      Ln.inspect(e, this.inspectOpts)
        .split(
          `
`
        )
        .map((t) => t.trim())
        .join(' ')
    )
  }
  xa.O = function (e) {
    return (
      (this.inspectOpts.colors = this.useColors),
      Ln.inspect(e, this.inspectOpts)
    )
  }
})
var Ta = F((a0, oo) => {
  typeof process > 'u' ||
  process.type === 'renderer' ||
  process.browser === !0 ||
  process.__nwjs
    ? (oo.exports = wa())
    : (oo.exports = va())
})
var Ia = F((H0, yd) => {
  yd.exports = {
    name: '@prisma/engines-version',
    version: '4.12.0-67.659ef412370fa3b41cd7bf6e94587c1dfb7f67e7',
    main: 'index.js',
    types: 'index.d.ts',
    license: 'Apache-2.0',
    author: 'Tim Suchanek <suchanek@prisma.io>',
    prisma: { enginesVersion: '659ef412370fa3b41cd7bf6e94587c1dfb7f67e7' },
    repository: {
      type: 'git',
      url: 'https://github.com/prisma/engines-wrapper.git',
      directory: 'packages/engines-version',
    },
    devDependencies: { '@types/node': '16.11.64', typescript: '4.8.4' },
    files: ['index.js', 'index.d.ts'],
    scripts: { build: 'tsc -d' },
  }
})
var uo = F((Gn) => {
  'use strict'
  Object.defineProperty(Gn, '__esModule', { value: !0 })
  Gn.enginesVersion = void 0
  Gn.enginesVersion = Ia().prisma.enginesVersion
})
var La = F((lb, po) => {
  'use strict'
  var I = po.exports
  po.exports.default = I
  var k = '\x1B[',
    _r = '\x1B]',
    Vt = '\x07',
    Wn = ';',
    $a = process.env.TERM_PROGRAM === 'Apple_Terminal'
  I.cursorTo = (e, t) => {
    if (typeof e != 'number')
      throw new TypeError('The `x` argument is required')
    return typeof t != 'number'
      ? k + (e + 1) + 'G'
      : k + (t + 1) + ';' + (e + 1) + 'H'
  }
  I.cursorMove = (e, t) => {
    if (typeof e != 'number')
      throw new TypeError('The `x` argument is required')
    let r = ''
    return (
      e < 0 ? (r += k + -e + 'D') : e > 0 && (r += k + e + 'C'),
      t < 0 ? (r += k + -t + 'A') : t > 0 && (r += k + t + 'B'),
      r
    )
  }
  I.cursorUp = (e = 1) => k + e + 'A'
  I.cursorDown = (e = 1) => k + e + 'B'
  I.cursorForward = (e = 1) => k + e + 'C'
  I.cursorBackward = (e = 1) => k + e + 'D'
  I.cursorLeft = k + 'G'
  I.cursorSavePosition = $a ? '\x1B7' : k + 's'
  I.cursorRestorePosition = $a ? '\x1B8' : k + 'u'
  I.cursorGetPosition = k + '6n'
  I.cursorNextLine = k + 'E'
  I.cursorPrevLine = k + 'F'
  I.cursorHide = k + '?25l'
  I.cursorShow = k + '?25h'
  I.eraseLines = (e) => {
    let t = ''
    for (let r = 0; r < e; r++)
      t += I.eraseLine + (r < e - 1 ? I.cursorUp() : '')
    return e && (t += I.cursorLeft), t
  }
  I.eraseEndLine = k + 'K'
  I.eraseStartLine = k + '1K'
  I.eraseLine = k + '2K'
  I.eraseDown = k + 'J'
  I.eraseUp = k + '1J'
  I.eraseScreen = k + '2J'
  I.scrollUp = k + 'S'
  I.scrollDown = k + 'T'
  I.clearScreen = '\x1Bc'
  I.clearTerminal =
    process.platform === 'win32'
      ? `${I.eraseScreen}${k}0f`
      : `${I.eraseScreen}${k}3J${k}H`
  I.beep = Vt
  I.link = (e, t) => [_r, '8', Wn, Wn, t, Vt, e, _r, '8', Wn, Wn, Vt].join('')
  I.image = (e, t = {}) => {
    let r = `${_r}1337;File=inline=1`
    return (
      t.width && (r += `;width=${t.width}`),
      t.height && (r += `;height=${t.height}`),
      t.preserveAspectRatio === !1 && (r += ';preserveAspectRatio=0'),
      r + ':' + e.toString('base64') + Vt
    )
  }
  I.iTerm = {
    setCwd: (e = process.cwd()) => `${_r}50;CurrentDir=${e}${Vt}`,
    annotation: (e, t = {}) => {
      let r = `${_r}1337;`,
        n = typeof t.x < 'u',
        i = typeof t.y < 'u'
      if ((n || i) && !(n && i && typeof t.length < 'u'))
        throw new Error(
          '`x`, `y` and `length` must be defined when `x` or `y` is defined'
        )
      return (
        (e = e.replace(/\|/g, '')),
        (r += t.isHidden ? 'AddHiddenAnnotation=' : 'AddAnnotation='),
        t.length > 0
          ? (r += (n ? [e, t.length, t.x, t.y] : [t.length, e]).join('|'))
          : (r += e),
        r + Vt
      )
    },
  }
})
var qa = F((ub, Ba) => {
  'use strict'
  var wd = En(),
    Ut = Vi()
  function ja(e) {
    if (/^\d{3,4}$/.test(e)) {
      let r = /(\d{1,2})(\d{2})/.exec(e)
      return { major: 0, minor: parseInt(r[1], 10), patch: parseInt(r[2], 10) }
    }
    let t = (e || '').split('.').map((r) => parseInt(r, 10))
    return { major: t[0], minor: t[1], patch: t[2] }
  }
  a(ja, 'parseVersion')
  function fo(e) {
    let { env: t } = process
    if ('FORCE_HYPERLINK' in t)
      return !(
        t.FORCE_HYPERLINK.length > 0 && parseInt(t.FORCE_HYPERLINK, 10) === 0
      )
    if (
      Ut('no-hyperlink') ||
      Ut('no-hyperlinks') ||
      Ut('hyperlink=false') ||
      Ut('hyperlink=never')
    )
      return !1
    if (Ut('hyperlink=true') || Ut('hyperlink=always') || 'NETLIFY' in t)
      return !0
    if (
      !wd.supportsColor(e) ||
      (e && !e.isTTY) ||
      process.platform === 'win32' ||
      'CI' in t ||
      'TEAMCITY_VERSION' in t
    )
      return !1
    if ('TERM_PROGRAM' in t) {
      let r = ja(t.TERM_PROGRAM_VERSION)
      switch (t.TERM_PROGRAM) {
        case 'iTerm.app':
          return r.major === 3 ? r.minor >= 1 : r.major > 3
        case 'WezTerm':
          return r.major >= 20200620
        case 'vscode':
          return r.major > 1 || (r.major === 1 && r.minor >= 72)
      }
    }
    if ('VTE_VERSION' in t) {
      if (t.VTE_VERSION === '0.50.0') return !1
      let r = ja(t.VTE_VERSION)
      return r.major > 0 || r.minor >= 50
    }
    return !1
  }
  a(fo, 'supportsHyperlink')
  Ba.exports = {
    supportsHyperlink: fo,
    stdout: fo(process.stdout),
    stderr: fo(process.stderr),
  }
})
var Ua = F((pb, Cr) => {
  'use strict'
  var xd = La(),
    mo = qa(),
    Va = a(
      (e, t, { target: r = 'stdout', ...n } = {}) =>
        mo[r]
          ? xd.link(e, t)
          : n.fallback === !1
          ? e
          : typeof n.fallback == 'function'
          ? n.fallback(e, t)
          : `${e} (\u200B${t}\u200B)`,
      'terminalLink'
    )
  Cr.exports = (e, t, r = {}) => Va(e, t, r)
  Cr.exports.stderr = (e, t, r = {}) => Va(e, t, { target: 'stderr', ...r })
  Cr.exports.isSupported = mo.stdout
  Cr.exports.stderr.isSupported = mo.stderr
})
var nl = F((Hb, rl) => {
  'use strict'
  rl.exports = ({ onlyFirst: e = !1 } = {}) => {
    let t = [
      '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
      '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',
    ].join('|')
    return new RegExp(t, e ? void 0 : 'g')
  }
})
var Rr = F((Yb, il) => {
  'use strict'
  var Ld = nl()
  il.exports = (e) => (typeof e == 'string' ? e.replace(Ld(), '') : e)
})
var ol = F((zb, Yn) => {
  'use strict'
  Yn.exports = (e = {}) => {
    let t
    if (e.repoUrl) t = e.repoUrl
    else if (e.user && e.repo) t = `https://github.com/${e.user}/${e.repo}`
    else
      throw new Error(
        'You need to specify either the `repoUrl` option or both the `user` and `repo` options'
      )
    let r = new URL(`${t}/issues/new`),
      n = [
        'body',
        'title',
        'labels',
        'template',
        'milestone',
        'assignee',
        'projects',
      ]
    for (let i of n) {
      let o = e[i]
      if (o !== void 0) {
        if (i === 'labels' || i === 'projects') {
          if (!Array.isArray(o))
            throw new TypeError(`The \`${i}\` option should be an array`)
          o = o.join(',')
        }
        r.searchParams.set(i, o)
      }
    }
    return r.toString()
  }
  Yn.exports.default = Yn.exports
})
var zl = F((Mx, xm) => {
  xm.exports = {
    name: 'dotenv',
    version: '16.0.3',
    description: 'Loads environment variables from .env file',
    main: 'lib/main.js',
    types: 'lib/main.d.ts',
    exports: {
      '.': {
        require: './lib/main.js',
        types: './lib/main.d.ts',
        default: './lib/main.js',
      },
      './config': './config.js',
      './config.js': './config.js',
      './lib/env-options': './lib/env-options.js',
      './lib/env-options.js': './lib/env-options.js',
      './lib/cli-options': './lib/cli-options.js',
      './lib/cli-options.js': './lib/cli-options.js',
      './package.json': './package.json',
    },
    scripts: {
      'dts-check': 'tsc --project tests/types/tsconfig.json',
      lint: 'standard',
      'lint-readme': 'standard-markdown',
      pretest: 'npm run lint && npm run dts-check',
      test: 'tap tests/*.js --100 -Rspec',
      prerelease: 'npm test',
      release: 'standard-version',
    },
    repository: { type: 'git', url: 'git://github.com/motdotla/dotenv.git' },
    keywords: [
      'dotenv',
      'env',
      '.env',
      'environment',
      'variables',
      'config',
      'settings',
    ],
    readmeFilename: 'README.md',
    license: 'BSD-2-Clause',
    devDependencies: {
      '@types/node': '^17.0.9',
      decache: '^4.6.1',
      dtslint: '^3.7.0',
      sinon: '^12.0.1',
      standard: '^16.0.4',
      'standard-markdown': '^7.1.0',
      'standard-version': '^9.3.2',
      tap: '^15.1.6',
      tar: '^6.1.11',
      typescript: '^4.5.4',
    },
    engines: { node: '>=12' },
  }
})
var Zl = F((Nx, si) => {
  var vm = require('fs'),
    Xl = require('path'),
    Tm = require('os'),
    Am = zl(),
    Sm = Am.version,
    Pm =
      /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm
  function _m(e) {
    let t = {},
      r = e.toString()
    r = r.replace(
      /\r\n?/gm,
      `
`
    )
    let n
    for (; (n = Pm.exec(r)) != null; ) {
      let i = n[1],
        o = n[2] || ''
      o = o.trim()
      let s = o[0]
      ;(o = o.replace(/^(['"`])([\s\S]*)\1$/gm, '$2')),
        s === '"' &&
          ((o = o.replace(
            /\\n/g,
            `
`
          )),
          (o = o.replace(/\\r/g, '\r'))),
        (t[i] = o)
    }
    return t
  }
  a(_m, 'parse')
  function No(e) {
    console.log(`[dotenv@${Sm}][DEBUG] ${e}`)
  }
  a(No, '_log')
  function Cm(e) {
    return e[0] === '~' ? Xl.join(Tm.homedir(), e.slice(1)) : e
  }
  a(Cm, '_resolveHome')
  function Om(e) {
    let t = Xl.resolve(process.cwd(), '.env'),
      r = 'utf8',
      n = Boolean(e && e.debug),
      i = Boolean(e && e.override)
    e &&
      (e.path != null && (t = Cm(e.path)),
      e.encoding != null && (r = e.encoding))
    try {
      let o = oi.parse(vm.readFileSync(t, { encoding: r }))
      return (
        Object.keys(o).forEach(function (s) {
          Object.prototype.hasOwnProperty.call(process.env, s)
            ? (i === !0 && (process.env[s] = o[s]),
              n &&
                No(
                  i === !0
                    ? `"${s}" is already defined in \`process.env\` and WAS overwritten`
                    : `"${s}" is already defined in \`process.env\` and was NOT overwritten`
                ))
            : (process.env[s] = o[s])
        }),
        { parsed: o }
      )
    } catch (o) {
      return n && No(`Failed to load ${t} ${o.message}`), { error: o }
    }
  }
  a(Om, 'config')
  var oi = { config: Om, parse: _m }
  si.exports.config = oi.config
  si.exports.parse = oi.parse
  si.exports = oi
})
var ou = F((qx, iu) => {
  var Do = Symbol('arg flag'),
    ce = class extends Error {
      constructor(t, r) {
        super(t),
          (this.name = 'ArgError'),
          (this.code = r),
          Object.setPrototypeOf(this, ce.prototype)
      }
    }
  a(ce, 'ArgError')
  function Gr(
    e,
    {
      argv: t = process.argv.slice(2),
      permissive: r = !1,
      stopAtPositional: n = !1,
    } = {}
  ) {
    if (!e)
      throw new ce(
        'argument specification object is required',
        'ARG_CONFIG_NO_SPEC'
      )
    let i = { _: [] },
      o = {},
      s = {}
    for (let l of Object.keys(e)) {
      if (!l)
        throw new ce(
          'argument key cannot be an empty string',
          'ARG_CONFIG_EMPTY_KEY'
        )
      if (l[0] !== '-')
        throw new ce(
          `argument key must start with '-' but found: '${l}'`,
          'ARG_CONFIG_NONOPT_KEY'
        )
      if (l.length === 1)
        throw new ce(
          `argument key must have a name; singular '-' keys are not allowed: ${l}`,
          'ARG_CONFIG_NONAME_KEY'
        )
      if (typeof e[l] == 'string') {
        o[l] = e[l]
        continue
      }
      let u = e[l],
        c = !1
      if (Array.isArray(u) && u.length === 1 && typeof u[0] == 'function') {
        let [p] = u
        ;(u = a(
          (f, d, m = []) => (m.push(p(f, d, m[m.length - 1])), m),
          'type'
        )),
          (c = p === Boolean || p[Do] === !0)
      } else if (typeof u == 'function') c = u === Boolean || u[Do] === !0
      else
        throw new ce(
          `type missing or not a function or valid array type: ${l}`,
          'ARG_CONFIG_VAD_TYPE'
        )
      if (l[1] !== '-' && l.length > 2)
        throw new ce(
          `short argument keys (with a single hyphen) must have only one character: ${l}`,
          'ARG_CONFIG_SHORTOPT_TOOLONG'
        )
      s[l] = [u, c]
    }
    for (let l = 0, u = t.length; l < u; l++) {
      let c = t[l]
      if (n && i._.length > 0) {
        i._ = i._.concat(t.slice(l))
        break
      }
      if (c === '--') {
        i._ = i._.concat(t.slice(l + 1))
        break
      }
      if (c.length > 1 && c[0] === '-') {
        let p =
          c[1] === '-' || c.length === 2
            ? [c]
            : c
                .slice(1)
                .split('')
                .map((f) => `-${f}`)
        for (let f = 0; f < p.length; f++) {
          let d = p[f],
            [m, h] = d[1] === '-' ? d.split(/=(.*)/, 2) : [d, void 0],
            g = m
          for (; g in o; ) g = o[g]
          if (!(g in s))
            if (r) {
              i._.push(d)
              continue
            } else
              throw new ce(
                `unknown or unexpected option: ${m}`,
                'ARG_UNKNOWN_OPTION'
              )
          let [b, y] = s[g]
          if (!y && f + 1 < p.length)
            throw new ce(
              `option requires argument (but was followed by another short argument): ${m}`,
              'ARG_MISSING_REQUIRED_SHORTARG'
            )
          if (y) i[g] = b(!0, g, i[g])
          else if (h === void 0) {
            if (
              t.length < l + 2 ||
              (t[l + 1].length > 1 &&
                t[l + 1][0] === '-' &&
                !(
                  t[l + 1].match(/^-?\d*(\.(?=\d))?\d*$/) &&
                  (b === Number || (typeof BigInt < 'u' && b === BigInt))
                ))
            ) {
              let x = m === g ? '' : ` (alias for ${g})`
              throw new ce(
                `option requires argument: ${m}${x}`,
                'ARG_MISSING_REQUIRED_LONGARG'
              )
            }
            ;(i[g] = b(t[l + 1], g, i[g])), ++l
          } else i[g] = b(h, g, i[g])
        }
      } else i._.push(c)
    }
    return i
  }
  a(Gr, 'arg')
  Gr.flag = (e) => ((e[Do] = !0), e)
  Gr.COUNT = Gr.flag((e, t, r) => (r || 0) + 1)
  Gr.ArgError = ce
  iu.exports = Gr
})
var au = F((Ux, su) => {
  'use strict'
  su.exports = (e) => {
    let t = e.match(/^[ \t]*(?=\S)/gm)
    return t ? t.reduce((r, n) => Math.min(r, n.length), 1 / 0) : 0
  }
})
var ko = F((Gx, lu) => {
  'use strict'
  var Fm = au()
  lu.exports = (e) => {
    let t = Fm(e)
    if (t === 0) return e
    let r = new RegExp(`^[ \\t]{${t}}`, 'gm')
    return e.replace(r, '')
  }
})
var pu = F((Uo, Go) => {
  ;(function (e, t) {
    typeof require == 'function' &&
    typeof Uo == 'object' &&
    typeof Go == 'object'
      ? (Go.exports = t())
      : (e.pluralize = t())
  })(Uo, function () {
    var e = [],
      t = [],
      r = {},
      n = {},
      i = {}
    function o(m) {
      return typeof m == 'string' ? new RegExp('^' + m + '$', 'i') : m
    }
    a(o, 'sanitizeRule')
    function s(m, h) {
      return m === h
        ? h
        : m === m.toLowerCase()
        ? h.toLowerCase()
        : m === m.toUpperCase()
        ? h.toUpperCase()
        : m[0] === m[0].toUpperCase()
        ? h.charAt(0).toUpperCase() + h.substr(1).toLowerCase()
        : h.toLowerCase()
    }
    a(s, 'restoreCase')
    function l(m, h) {
      return m.replace(/\$(\d{1,2})/g, function (g, b) {
        return h[b] || ''
      })
    }
    a(l, 'interpolate')
    function u(m, h) {
      return m.replace(h[0], function (g, b) {
        var y = l(h[1], arguments)
        return s(g === '' ? m[b - 1] : g, y)
      })
    }
    a(u, 'replace')
    function c(m, h, g) {
      if (!m.length || r.hasOwnProperty(m)) return h
      for (var b = g.length; b--; ) {
        var y = g[b]
        if (y[0].test(h)) return u(h, y)
      }
      return h
    }
    a(c, 'sanitizeWord')
    function p(m, h, g) {
      return function (b) {
        var y = b.toLowerCase()
        return h.hasOwnProperty(y)
          ? s(b, y)
          : m.hasOwnProperty(y)
          ? s(b, m[y])
          : c(y, b, g)
      }
    }
    a(p, 'replaceWord')
    function f(m, h, g, b) {
      return function (y) {
        var x = y.toLowerCase()
        return h.hasOwnProperty(x)
          ? !0
          : m.hasOwnProperty(x)
          ? !1
          : c(x, x, g) === x
      }
    }
    a(f, 'checkWord')
    function d(m, h, g) {
      var b = h === 1 ? d.singular(m) : d.plural(m)
      return (g ? h + ' ' : '') + b
    }
    return (
      a(d, 'pluralize'),
      (d.plural = p(i, n, e)),
      (d.isPlural = f(i, n, e)),
      (d.singular = p(n, i, t)),
      (d.isSingular = f(n, i, t)),
      (d.addPluralRule = function (m, h) {
        e.push([o(m), h])
      }),
      (d.addSingularRule = function (m, h) {
        t.push([o(m), h])
      }),
      (d.addUncountableRule = function (m) {
        if (typeof m == 'string') {
          r[m.toLowerCase()] = !0
          return
        }
        d.addPluralRule(m, '$0'), d.addSingularRule(m, '$0')
      }),
      (d.addIrregularRule = function (m, h) {
        ;(h = h.toLowerCase()), (m = m.toLowerCase()), (i[m] = h), (n[h] = m)
      }),
      [
        ['I', 'we'],
        ['me', 'us'],
        ['he', 'they'],
        ['she', 'they'],
        ['them', 'them'],
        ['myself', 'ourselves'],
        ['yourself', 'yourselves'],
        ['itself', 'themselves'],
        ['herself', 'themselves'],
        ['himself', 'themselves'],
        ['themself', 'themselves'],
        ['is', 'are'],
        ['was', 'were'],
        ['has', 'have'],
        ['this', 'these'],
        ['that', 'those'],
        ['echo', 'echoes'],
        ['dingo', 'dingoes'],
        ['volcano', 'volcanoes'],
        ['tornado', 'tornadoes'],
        ['torpedo', 'torpedoes'],
        ['genus', 'genera'],
        ['viscus', 'viscera'],
        ['stigma', 'stigmata'],
        ['stoma', 'stomata'],
        ['dogma', 'dogmata'],
        ['lemma', 'lemmata'],
        ['schema', 'schemata'],
        ['anathema', 'anathemata'],
        ['ox', 'oxen'],
        ['axe', 'axes'],
        ['die', 'dice'],
        ['yes', 'yeses'],
        ['foot', 'feet'],
        ['eave', 'eaves'],
        ['goose', 'geese'],
        ['tooth', 'teeth'],
        ['quiz', 'quizzes'],
        ['human', 'humans'],
        ['proof', 'proofs'],
        ['carve', 'carves'],
        ['valve', 'valves'],
        ['looey', 'looies'],
        ['thief', 'thieves'],
        ['groove', 'grooves'],
        ['pickaxe', 'pickaxes'],
        ['passerby', 'passersby'],
      ].forEach(function (m) {
        return d.addIrregularRule(m[0], m[1])
      }),
      [
        [/s?$/i, 's'],
        [/[^\u0000-\u007F]$/i, '$0'],
        [/([^aeiou]ese)$/i, '$1'],
        [/(ax|test)is$/i, '$1es'],
        [/(alias|[^aou]us|t[lm]as|gas|ris)$/i, '$1es'],
        [/(e[mn]u)s?$/i, '$1s'],
        [/([^l]ias|[aeiou]las|[ejzr]as|[iu]am)$/i, '$1'],
        [
          /(alumn|syllab|vir|radi|nucle|fung|cact|stimul|termin|bacill|foc|uter|loc|strat)(?:us|i)$/i,
          '$1i',
        ],
        [/(alumn|alg|vertebr)(?:a|ae)$/i, '$1ae'],
        [/(seraph|cherub)(?:im)?$/i, '$1im'],
        [/(her|at|gr)o$/i, '$1oes'],
        [
          /(agend|addend|millenni|dat|extrem|bacteri|desiderat|strat|candelabr|errat|ov|symposi|curricul|automat|quor)(?:a|um)$/i,
          '$1a',
        ],
        [
          /(apheli|hyperbat|periheli|asyndet|noumen|phenomen|criteri|organ|prolegomen|hedr|automat)(?:a|on)$/i,
          '$1a',
        ],
        [/sis$/i, 'ses'],
        [/(?:(kni|wi|li)fe|(ar|l|ea|eo|oa|hoo)f)$/i, '$1$2ves'],
        [/([^aeiouy]|qu)y$/i, '$1ies'],
        [/([^ch][ieo][ln])ey$/i, '$1ies'],
        [/(x|ch|ss|sh|zz)$/i, '$1es'],
        [/(matr|cod|mur|sil|vert|ind|append)(?:ix|ex)$/i, '$1ices'],
        [/\b((?:tit)?m|l)(?:ice|ouse)$/i, '$1ice'],
        [/(pe)(?:rson|ople)$/i, '$1ople'],
        [/(child)(?:ren)?$/i, '$1ren'],
        [/eaux$/i, '$0'],
        [/m[ae]n$/i, 'men'],
        ['thou', 'you'],
      ].forEach(function (m) {
        return d.addPluralRule(m[0], m[1])
      }),
      [
        [/s$/i, ''],
        [/(ss)$/i, '$1'],
        [
          /(wi|kni|(?:after|half|high|low|mid|non|night|[^\w]|^)li)ves$/i,
          '$1fe',
        ],
        [/(ar|(?:wo|[ae])l|[eo][ao])ves$/i, '$1f'],
        [/ies$/i, 'y'],
        [
          /\b([pl]|zomb|(?:neck|cross)?t|coll|faer|food|gen|goon|group|lass|talk|goal|cut)ies$/i,
          '$1ie',
        ],
        [/\b(mon|smil)ies$/i, '$1ey'],
        [/\b((?:tit)?m|l)ice$/i, '$1ouse'],
        [/(seraph|cherub)im$/i, '$1'],
        [
          /(x|ch|ss|sh|zz|tto|go|cho|alias|[^aou]us|t[lm]as|gas|(?:her|at|gr)o|[aeiou]ris)(?:es)?$/i,
          '$1',
        ],
        [
          /(analy|diagno|parenthe|progno|synop|the|empha|cri|ne)(?:sis|ses)$/i,
          '$1sis',
        ],
        [/(movie|twelve|abuse|e[mn]u)s$/i, '$1'],
        [/(test)(?:is|es)$/i, '$1is'],
        [
          /(alumn|syllab|vir|radi|nucle|fung|cact|stimul|termin|bacill|foc|uter|loc|strat)(?:us|i)$/i,
          '$1us',
        ],
        [
          /(agend|addend|millenni|dat|extrem|bacteri|desiderat|strat|candelabr|errat|ov|symposi|curricul|quor)a$/i,
          '$1um',
        ],
        [
          /(apheli|hyperbat|periheli|asyndet|noumen|phenomen|criteri|organ|prolegomen|hedr|automat)a$/i,
          '$1on',
        ],
        [/(alumn|alg|vertebr)ae$/i, '$1a'],
        [/(cod|mur|sil|vert|ind)ices$/i, '$1ex'],
        [/(matr|append)ices$/i, '$1ix'],
        [/(pe)(rson|ople)$/i, '$1rson'],
        [/(child)ren$/i, '$1'],
        [/(eau)x?$/i, '$1'],
        [/men$/i, 'man'],
      ].forEach(function (m) {
        return d.addSingularRule(m[0], m[1])
      }),
      [
        'adulthood',
        'advice',
        'agenda',
        'aid',
        'aircraft',
        'alcohol',
        'ammo',
        'analytics',
        'anime',
        'athletics',
        'audio',
        'bison',
        'blood',
        'bream',
        'buffalo',
        'butter',
        'carp',
        'cash',
        'chassis',
        'chess',
        'clothing',
        'cod',
        'commerce',
        'cooperation',
        'corps',
        'debris',
        'diabetes',
        'digestion',
        'elk',
        'energy',
        'equipment',
        'excretion',
        'expertise',
        'firmware',
        'flounder',
        'fun',
        'gallows',
        'garbage',
        'graffiti',
        'hardware',
        'headquarters',
        'health',
        'herpes',
        'highjinks',
        'homework',
        'housework',
        'information',
        'jeans',
        'justice',
        'kudos',
        'labour',
        'literature',
        'machinery',
        'mackerel',
        'mail',
        'media',
        'mews',
        'moose',
        'music',
        'mud',
        'manga',
        'news',
        'only',
        'personnel',
        'pike',
        'plankton',
        'pliers',
        'police',
        'pollution',
        'premises',
        'rain',
        'research',
        'rice',
        'salmon',
        'scissors',
        'series',
        'sewage',
        'shambles',
        'shrimp',
        'software',
        'species',
        'staff',
        'swine',
        'tennis',
        'traffic',
        'transportation',
        'trout',
        'tuna',
        'wealth',
        'welfare',
        'whiting',
        'wildebeest',
        'wildlife',
        'you',
        /pok[eé]mon$/i,
        /[^aeiou]ese$/i,
        /deer$/i,
        /fish$/i,
        /measles$/i,
        /o[iu]s$/i,
        /pox$/i,
        /sheep$/i,
      ].forEach(d.addUncountableRule),
      d
    )
  })
})
var Iu = F((ET, Fu) => {
  'use strict'
  Fu.exports = (e) => Object.prototype.toString.call(e) === '[object RegExp]'
})
var ku = F((wT, Du) => {
  'use strict'
  Du.exports = (e) => {
    let t = typeof e
    return e !== null && (t === 'object' || t === 'function')
  }
})
var $u = F((Qo) => {
  'use strict'
  Object.defineProperty(Qo, '__esModule', { value: !0 })
  Qo.default = (e) =>
    Object.getOwnPropertySymbols(e).filter((t) =>
      Object.prototype.propertyIsEnumerable.call(e, t)
    )
})
var rc = F((GA, qg) => {
  qg.exports = {
    name: '@prisma/client',
    version: '4.12.0',
    description:
      "Prisma Client is an auto-generated, type-safe and modern JavaScript/TypeScript ORM for Node.js that's tailored to your data. Supports MySQL, PostgreSQL, MariaDB, SQLite databases.",
    keywords: [
      'orm',
      'prisma2',
      'prisma',
      'client',
      'query',
      'database',
      'sql',
      'postgres',
      'postgresql',
      'mysql',
      'sqlite',
      'mariadb',
      'mssql',
      'typescript',
      'query-builder',
    ],
    main: 'index.js',
    browser: 'index-browser.js',
    types: 'index.d.ts',
    license: 'Apache-2.0',
    engines: { node: '>=14.17' },
    homepage: 'https://www.prisma.io',
    repository: {
      type: 'git',
      url: 'https://github.com/prisma/prisma.git',
      directory: 'packages/client',
    },
    author: 'Tim Suchanek <suchanek@prisma.io>',
    bugs: 'https://github.com/prisma/prisma/issues',
    scripts: {
      dev: 'DEV=true node -r esbuild-register helpers/build.ts',
      build: 'node -r esbuild-register helpers/build.ts',
      test: 'jest --verbose',
      'test:e2e': 'node -r esbuild-register tests/e2e/_utils/run.ts',
      'test:functional':
        'node -r esbuild-register helpers/functional-test/run-tests.ts',
      'test:memory': 'node -r esbuild-register helpers/memory-tests.ts',
      'test:functional:code':
        'node -r esbuild-register helpers/functional-test/run-tests.ts --no-types',
      'test:functional:types':
        'node -r esbuild-register helpers/functional-test/run-tests.ts --types-only',
      'test-notypes':
        'jest --verbose --testPathIgnorePatterns src/__tests__/types/types.test.ts',
      generate: 'node scripts/postinstall.js',
      postinstall: 'node scripts/postinstall.js',
      prepublishOnly: 'pnpm run build',
      'new-test':
        "NODE_OPTIONS='-r ts-node/register' yo ./helpers/generator-test/index.ts",
    },
    files: [
      'README.md',
      'runtime',
      '!runtime/*.map',
      'scripts',
      'generator-build',
      'edge.js',
      'edge.d.ts',
      'index.js',
      'index.d.ts',
      'index-browser.js',
    ],
    devDependencies: {
      '@codspeed/benchmark.js-plugin': '1.0.2',
      '@faker-js/faker': '7.6.0',
      '@fast-check/jest': '1.6.0',
      '@jest/globals': '29.4.3',
      '@jest/test-sequencer': '29.4.3',
      '@opentelemetry/api': '1.4.0',
      '@opentelemetry/context-async-hooks': '1.9.1',
      '@opentelemetry/instrumentation': '0.35.1',
      '@opentelemetry/resources': '1.9.1',
      '@opentelemetry/sdk-trace-base': '1.9.1',
      '@opentelemetry/semantic-conventions': '1.9.1',
      '@prisma/debug': 'workspace:*',
      '@prisma/engine-core': 'workspace:*',
      '@prisma/engines': 'workspace:*',
      '@prisma/fetch-engine': 'workspace:*',
      '@prisma/generator-helper': 'workspace:*',
      '@prisma/get-platform': 'workspace:*',
      '@prisma/instrumentation': 'workspace:*',
      '@prisma/internals': 'workspace:*',
      '@prisma/migrate': 'workspace:*',
      '@prisma/mini-proxy': '0.6.4',
      '@swc-node/register': '1.5.5',
      '@swc/core': '1.3.32',
      '@swc/jest': '0.2.24',
      '@timsuchanek/copy': '1.4.5',
      '@types/debug': '4.1.7',
      '@types/fs-extra': '9.0.13',
      '@types/jest': '29.4.0',
      '@types/js-levenshtein': '1.1.1',
      '@types/mssql': '8.1.2',
      '@types/node': '14.18.36',
      '@types/pg': '8.6.6',
      '@types/yeoman-generator': '5.2.11',
      arg: '5.0.2',
      benchmark: '2.1.4',
      chalk: '4.1.2',
      'decimal.js': '10.4.3',
      esbuild: '0.15.13',
      execa: '5.1.1',
      'expect-type': '0.15.0',
      'flat-map-polyfill': '0.3.8',
      'fs-extra': '11.1.0',
      'fs-monkey': '1.0.3',
      'get-own-enumerable-property-symbols': '3.0.2',
      globby: '11.1.0',
      'indent-string': '4.0.0',
      'is-obj': '2.0.0',
      'is-regexp': '2.1.0',
      jest: '29.4.3',
      'jest-junit': '15.0.0',
      'jest-serializer-ansi-escapes': '^2.0.1',
      'jest-snapshot': '29.4.3',
      'js-levenshtein': '1.1.6',
      klona: '2.0.6',
      'lz-string': '1.4.4',
      mariadb: '3.0.2',
      memfs: '3.4.13',
      mssql: '9.1.1',
      'node-fetch': '2.6.9',
      pg: '8.9.0',
      'pkg-up': '3.1.0',
      pluralize: '8.0.0',
      resolve: '1.22.1',
      rimraf: '3.0.2',
      'simple-statistics': '7.8.2',
      'sort-keys': '4.2.0',
      'source-map-support': '0.5.21',
      'sql-template-tag': '5.0.3',
      'stacktrace-parser': '0.1.10',
      'strip-ansi': '6.0.1',
      'strip-indent': '3.0.0',
      'ts-jest': '29.0.5',
      'ts-node': '10.9.1',
      'ts-pattern': '4.1.3',
      tsd: '0.21.0',
      typescript: '4.9.5',
      'yeoman-generator': '5.7.0',
      yo: '4.3.1',
      zx: '7.1.1',
    },
    peerDependencies: { prisma: '*' },
    peerDependenciesMeta: { prisma: { optional: !0 } },
    dependencies: {
      '@prisma/engines-version':
        '4.12.0-67.659ef412370fa3b41cd7bf6e94587c1dfb7f67e7',
    },
    sideEffects: !1,
  }
})
var ey = {}
gn(ey, {
  DMMF: () => Ie,
  DMMFClass: () => qe,
  Debug: () => so,
  Decimal: () => ye,
  Engine: () => nt,
  Extensions: () => ki,
  MetricsClient: () => mt,
  NotFoundError: () => Pe,
  PrismaClientInitializationError: () => G,
  PrismaClientKnownRequestError: () => X,
  PrismaClientRustPanicError: () => fe,
  PrismaClientUnknownRequestError: () => Z,
  PrismaClientValidationError: () => J,
  Sql: () => he,
  Types: () => $i,
  decompressFromBase64: () => Zh,
  empty: () => Pc,
  findSync: () => ds,
  getPrismaClient: () => Xc,
  join: () => Sc,
  makeDocument: () => yi,
  makeStrictEnum: () => Zc,
  objectEnumValues: () => Rt,
  raw: () => as,
  sqltag: () => ls,
  transformDocument: () => Bu,
  unpack: () => bi,
  warnEnvConflicts: () => rp,
})
module.exports = up(ey)
var np = O(gs())
var ki = {}
gn(ki, { defineExtension: () => hs, getExtensionContext: () => ys })
function hs(e) {
  return typeof e == 'function' ? e : (t) => t.$extends(e)
}
a(hs, 'defineExtension')
function ys(e) {
  return e
}
a(ys, 'getExtensionContext')
var $i = {}
gn($i, { Extensions: () => bs, Public: () => Es, Utils: () => ws })
var bs = {}
var Es = {}
var ws = {}
var mt = class {
  constructor(t) {
    this._engine = t
  }
  prometheus(t) {
    return this._engine.metrics({ format: 'prometheus', ...t })
  }
  json(t) {
    return this._engine.metrics({ format: 'json', ...t })
  }
}
a(mt, 'MetricsClient')
function Li(e, t) {
  for (let r of t)
    for (let n of Object.getOwnPropertyNames(r.prototype))
      Object.defineProperty(
        e.prototype,
        n,
        Object.getOwnPropertyDescriptor(r.prototype, n) ?? Object.create(null)
      )
}
a(Li, 'applyMixins')
var Ze = O(ae())
var Ot = 9e15,
  ze = 1e9,
  Hi = '0123456789abcdef',
  Pn =
    '2.3025850929940456840179914546843642076011014886287729760333279009675726096773524802359972050895982983419677840422862486334095254650828067566662873690987816894829072083255546808437998948262331985283935053089653777326288461633662222876982198867465436674744042432743651550489343149393914796194044002221051017141748003688084012647080685567743216228355220114804663715659121373450747856947683463616792101806445070648000277502684916746550586856935673420670581136429224554405758925724208241314695689016758940256776311356919292033376587141660230105703089634572075440370847469940168269282808481184289314848524948644871927809676271275775397027668605952496716674183485704422507197965004714951050492214776567636938662976979522110718264549734772662425709429322582798502585509785265383207606726317164309505995087807523710333101197857547331541421808427543863591778117054309827482385045648019095610299291824318237525357709750539565187697510374970888692180205189339507238539205144634197265287286965110862571492198849978748873771345686209167058',
  _n =
    '3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679821480865132823066470938446095505822317253594081284811174502841027019385211055596446229489549303819644288109756659334461284756482337867831652712019091456485669234603486104543266482133936072602491412737245870066063155881748815209209628292540917153643678925903600113305305488204665213841469519415116094330572703657595919530921861173819326117931051185480744623799627495673518857527248912279381830119491298336733624406566430860213949463952247371907021798609437027705392171762931767523846748184676694051320005681271452635608277857713427577896091736371787214684409012249534301465495853710507922796892589235420199561121290219608640344181598136297747713099605187072113499999983729780499510597317328160963185950244594553469083026425223082533446850352619311881710100031378387528865875332083814206171776691473035982534904287554687311595628638823537875937519577818577805321712268066130019278766111959092164201989380952572010654858632789',
  Yi = {
    precision: 20,
    rounding: 4,
    modulo: 1,
    toExpNeg: -7,
    toExpPos: 21,
    minE: -Ot,
    maxE: Ot,
    crypto: !1,
  },
  ea,
  Be,
  N = !0,
  On = '[DecimalError] ',
  Ye = On + 'Invalid argument: ',
  ta = On + 'Precision limit exceeded',
  ra = On + 'crypto unavailable',
  na = '[object Decimal]',
  ne = Math.floor,
  Q = Math.pow,
  Dp = /^0b([01]+(\.[01]*)?|\.[01]+)(p[+-]?\d+)?$/i,
  kp = /^0x([0-9a-f]+(\.[0-9a-f]*)?|\.[0-9a-f]+)(p[+-]?\d+)?$/i,
  $p = /^0o([0-7]+(\.[0-7]*)?|\.[0-7]+)(p[+-]?\d+)?$/i,
  ia = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i,
  Ce = 1e7,
  M = 7,
  Lp = 9007199254740991,
  jp = Pn.length - 1,
  zi = _n.length - 1,
  v = { toStringTag: na }
v.absoluteValue = v.abs = function () {
  var e = new this.constructor(this)
  return e.s < 0 && (e.s = 1), _(e)
}
v.ceil = function () {
  return _(new this.constructor(this), this.e + 1, 2)
}
v.clampedTo = v.clamp = function (e, t) {
  var r,
    n = this,
    i = n.constructor
  if (((e = new i(e)), (t = new i(t)), !e.s || !t.s)) return new i(NaN)
  if (e.gt(t)) throw Error(Ye + t)
  return (r = n.cmp(e)), r < 0 ? e : n.cmp(t) > 0 ? t : new i(n)
}
v.comparedTo = v.cmp = function (e) {
  var t,
    r,
    n,
    i,
    o = this,
    s = o.d,
    l = (e = new o.constructor(e)).d,
    u = o.s,
    c = e.s
  if (!s || !l)
    return !u || !c ? NaN : u !== c ? u : s === l ? 0 : !s ^ (u < 0) ? 1 : -1
  if (!s[0] || !l[0]) return s[0] ? u : l[0] ? -c : 0
  if (u !== c) return u
  if (o.e !== e.e) return (o.e > e.e) ^ (u < 0) ? 1 : -1
  for (n = s.length, i = l.length, t = 0, r = n < i ? n : i; t < r; ++t)
    if (s[t] !== l[t]) return (s[t] > l[t]) ^ (u < 0) ? 1 : -1
  return n === i ? 0 : (n > i) ^ (u < 0) ? 1 : -1
}
v.cosine = v.cos = function () {
  var e,
    t,
    r = this,
    n = r.constructor
  return r.d
    ? r.d[0]
      ? ((e = n.precision),
        (t = n.rounding),
        (n.precision = e + Math.max(r.e, r.sd()) + M),
        (n.rounding = 1),
        (r = Bp(n, ua(n, r))),
        (n.precision = e),
        (n.rounding = t),
        _(Be == 2 || Be == 3 ? r.neg() : r, e, t, !0))
      : new n(1)
    : new n(NaN)
}
v.cubeRoot = v.cbrt = function () {
  var e,
    t,
    r,
    n,
    i,
    o,
    s,
    l,
    u,
    c,
    p = this,
    f = p.constructor
  if (!p.isFinite() || p.isZero()) return new f(p)
  for (
    N = !1,
      o = p.s * Q(p.s * p, 1 / 3),
      !o || Math.abs(o) == 1 / 0
        ? ((r = H(p.d)),
          (e = p.e),
          (o = (e - r.length + 1) % 3) && (r += o == 1 || o == -2 ? '0' : '00'),
          (o = Q(r, 1 / 3)),
          (e = ne((e + 1) / 3) - (e % 3 == (e < 0 ? -1 : 2))),
          o == 1 / 0
            ? (r = '5e' + e)
            : ((r = o.toExponential()),
              (r = r.slice(0, r.indexOf('e') + 1) + e)),
          (n = new f(r)),
          (n.s = p.s))
        : (n = new f(o.toString())),
      s = (e = f.precision) + 3;
    ;

  )
    if (
      ((l = n),
      (u = l.times(l).times(l)),
      (c = u.plus(p)),
      (n = L(c.plus(p).times(l), c.plus(u), s + 2, 1)),
      H(l.d).slice(0, s) === (r = H(n.d)).slice(0, s))
    )
      if (((r = r.slice(s - 3, s + 1)), r == '9999' || (!i && r == '4999'))) {
        if (!i && (_(l, e + 1, 0), l.times(l).times(l).eq(p))) {
          n = l
          break
        }
        ;(s += 4), (i = 1)
      } else {
        ;(!+r || (!+r.slice(1) && r.charAt(0) == '5')) &&
          (_(n, e + 1, 1), (t = !n.times(n).times(n).eq(p)))
        break
      }
  return (N = !0), _(n, e, f.rounding, t)
}
v.decimalPlaces = v.dp = function () {
  var e,
    t = this.d,
    r = NaN
  if (t) {
    if (((e = t.length - 1), (r = (e - ne(this.e / M)) * M), (e = t[e]), e))
      for (; e % 10 == 0; e /= 10) r--
    r < 0 && (r = 0)
  }
  return r
}
v.dividedBy = v.div = function (e) {
  return L(this, new this.constructor(e))
}
v.dividedToIntegerBy = v.divToInt = function (e) {
  var t = this,
    r = t.constructor
  return _(L(t, new r(e), 0, 1, 1), r.precision, r.rounding)
}
v.equals = v.eq = function (e) {
  return this.cmp(e) === 0
}
v.floor = function () {
  return _(new this.constructor(this), this.e + 1, 3)
}
v.greaterThan = v.gt = function (e) {
  return this.cmp(e) > 0
}
v.greaterThanOrEqualTo = v.gte = function (e) {
  var t = this.cmp(e)
  return t == 1 || t === 0
}
v.hyperbolicCosine = v.cosh = function () {
  var e,
    t,
    r,
    n,
    i,
    o = this,
    s = o.constructor,
    l = new s(1)
  if (!o.isFinite()) return new s(o.s ? 1 / 0 : NaN)
  if (o.isZero()) return l
  ;(r = s.precision),
    (n = s.rounding),
    (s.precision = r + Math.max(o.e, o.sd()) + 4),
    (s.rounding = 1),
    (i = o.d.length),
    i < 32
      ? ((e = Math.ceil(i / 3)), (t = (1 / Nn(4, e)).toString()))
      : ((e = 16), (t = '2.3283064365386962890625e-10')),
    (o = Mt(s, 1, o.times(t), new s(1), !0))
  for (var u, c = e, p = new s(8); c--; )
    (u = o.times(o)), (o = l.minus(u.times(p.minus(u.times(p)))))
  return _(o, (s.precision = r), (s.rounding = n), !0)
}
v.hyperbolicSine = v.sinh = function () {
  var e,
    t,
    r,
    n,
    i = this,
    o = i.constructor
  if (!i.isFinite() || i.isZero()) return new o(i)
  if (
    ((t = o.precision),
    (r = o.rounding),
    (o.precision = t + Math.max(i.e, i.sd()) + 4),
    (o.rounding = 1),
    (n = i.d.length),
    n < 3)
  )
    i = Mt(o, 2, i, i, !0)
  else {
    ;(e = 1.4 * Math.sqrt(n)),
      (e = e > 16 ? 16 : e | 0),
      (i = i.times(1 / Nn(5, e))),
      (i = Mt(o, 2, i, i, !0))
    for (var s, l = new o(5), u = new o(16), c = new o(20); e--; )
      (s = i.times(i)), (i = i.times(l.plus(s.times(u.times(s).plus(c)))))
  }
  return (o.precision = t), (o.rounding = r), _(i, t, r, !0)
}
v.hyperbolicTangent = v.tanh = function () {
  var e,
    t,
    r = this,
    n = r.constructor
  return r.isFinite()
    ? r.isZero()
      ? new n(r)
      : ((e = n.precision),
        (t = n.rounding),
        (n.precision = e + 7),
        (n.rounding = 1),
        L(r.sinh(), r.cosh(), (n.precision = e), (n.rounding = t)))
    : new n(r.s)
}
v.inverseCosine = v.acos = function () {
  var e,
    t = this,
    r = t.constructor,
    n = t.abs().cmp(1),
    i = r.precision,
    o = r.rounding
  return n !== -1
    ? n === 0
      ? t.isNeg()
        ? _e(r, i, o)
        : new r(0)
      : new r(NaN)
    : t.isZero()
    ? _e(r, i + 4, o).times(0.5)
    : ((r.precision = i + 6),
      (r.rounding = 1),
      (t = t.asin()),
      (e = _e(r, i + 4, o).times(0.5)),
      (r.precision = i),
      (r.rounding = o),
      e.minus(t))
}
v.inverseHyperbolicCosine = v.acosh = function () {
  var e,
    t,
    r = this,
    n = r.constructor
  return r.lte(1)
    ? new n(r.eq(1) ? 0 : NaN)
    : r.isFinite()
    ? ((e = n.precision),
      (t = n.rounding),
      (n.precision = e + Math.max(Math.abs(r.e), r.sd()) + 4),
      (n.rounding = 1),
      (N = !1),
      (r = r.times(r).minus(1).sqrt().plus(r)),
      (N = !0),
      (n.precision = e),
      (n.rounding = t),
      r.ln())
    : new n(r)
}
v.inverseHyperbolicSine = v.asinh = function () {
  var e,
    t,
    r = this,
    n = r.constructor
  return !r.isFinite() || r.isZero()
    ? new n(r)
    : ((e = n.precision),
      (t = n.rounding),
      (n.precision = e + 2 * Math.max(Math.abs(r.e), r.sd()) + 6),
      (n.rounding = 1),
      (N = !1),
      (r = r.times(r).plus(1).sqrt().plus(r)),
      (N = !0),
      (n.precision = e),
      (n.rounding = t),
      r.ln())
}
v.inverseHyperbolicTangent = v.atanh = function () {
  var e,
    t,
    r,
    n,
    i = this,
    o = i.constructor
  return i.isFinite()
    ? i.e >= 0
      ? new o(i.abs().eq(1) ? i.s / 0 : i.isZero() ? i : NaN)
      : ((e = o.precision),
        (t = o.rounding),
        (n = i.sd()),
        Math.max(n, e) < 2 * -i.e - 1
          ? _(new o(i), e, t, !0)
          : ((o.precision = r = n - i.e),
            (i = L(i.plus(1), new o(1).minus(i), r + e, 1)),
            (o.precision = e + 4),
            (o.rounding = 1),
            (i = i.ln()),
            (o.precision = e),
            (o.rounding = t),
            i.times(0.5)))
    : new o(NaN)
}
v.inverseSine = v.asin = function () {
  var e,
    t,
    r,
    n,
    i = this,
    o = i.constructor
  return i.isZero()
    ? new o(i)
    : ((t = i.abs().cmp(1)),
      (r = o.precision),
      (n = o.rounding),
      t !== -1
        ? t === 0
          ? ((e = _e(o, r + 4, n).times(0.5)), (e.s = i.s), e)
          : new o(NaN)
        : ((o.precision = r + 6),
          (o.rounding = 1),
          (i = i.div(new o(1).minus(i.times(i)).sqrt().plus(1)).atan()),
          (o.precision = r),
          (o.rounding = n),
          i.times(2)))
}
v.inverseTangent = v.atan = function () {
  var e,
    t,
    r,
    n,
    i,
    o,
    s,
    l,
    u,
    c = this,
    p = c.constructor,
    f = p.precision,
    d = p.rounding
  if (c.isFinite()) {
    if (c.isZero()) return new p(c)
    if (c.abs().eq(1) && f + 4 <= zi)
      return (s = _e(p, f + 4, d).times(0.25)), (s.s = c.s), s
  } else {
    if (!c.s) return new p(NaN)
    if (f + 4 <= zi) return (s = _e(p, f + 4, d).times(0.5)), (s.s = c.s), s
  }
  for (
    p.precision = l = f + 10,
      p.rounding = 1,
      r = Math.min(28, (l / M + 2) | 0),
      e = r;
    e;
    --e
  )
    c = c.div(c.times(c).plus(1).sqrt().plus(1))
  for (
    N = !1, t = Math.ceil(l / M), n = 1, u = c.times(c), s = new p(c), i = c;
    e !== -1;

  )
    if (
      ((i = i.times(u)),
      (o = s.minus(i.div((n += 2)))),
      (i = i.times(u)),
      (s = o.plus(i.div((n += 2)))),
      s.d[t] !== void 0)
    )
      for (e = t; s.d[e] === o.d[e] && e--; );
  return (
    r && (s = s.times(2 << (r - 1))),
    (N = !0),
    _(s, (p.precision = f), (p.rounding = d), !0)
  )
}
v.isFinite = function () {
  return !!this.d
}
v.isInteger = v.isInt = function () {
  return !!this.d && ne(this.e / M) > this.d.length - 2
}
v.isNaN = function () {
  return !this.s
}
v.isNegative = v.isNeg = function () {
  return this.s < 0
}
v.isPositive = v.isPos = function () {
  return this.s > 0
}
v.isZero = function () {
  return !!this.d && this.d[0] === 0
}
v.lessThan = v.lt = function (e) {
  return this.cmp(e) < 0
}
v.lessThanOrEqualTo = v.lte = function (e) {
  return this.cmp(e) < 1
}
v.logarithm = v.log = function (e) {
  var t,
    r,
    n,
    i,
    o,
    s,
    l,
    u,
    c = this,
    p = c.constructor,
    f = p.precision,
    d = p.rounding,
    m = 5
  if (e == null) (e = new p(10)), (t = !0)
  else {
    if (((e = new p(e)), (r = e.d), e.s < 0 || !r || !r[0] || e.eq(1)))
      return new p(NaN)
    t = e.eq(10)
  }
  if (((r = c.d), c.s < 0 || !r || !r[0] || c.eq(1)))
    return new p(r && !r[0] ? -1 / 0 : c.s != 1 ? NaN : r ? 0 : 1 / 0)
  if (t)
    if (r.length > 1) o = !0
    else {
      for (i = r[0]; i % 10 === 0; ) i /= 10
      o = i !== 1
    }
  if (
    ((N = !1),
    (l = f + m),
    (s = He(c, l)),
    (n = t ? Cn(p, l + 10) : He(e, l)),
    (u = L(s, n, l, 1)),
    pr(u.d, (i = f), d))
  )
    do
      if (
        ((l += 10),
        (s = He(c, l)),
        (n = t ? Cn(p, l + 10) : He(e, l)),
        (u = L(s, n, l, 1)),
        !o)
      ) {
        ;+H(u.d).slice(i + 1, i + 15) + 1 == 1e14 && (u = _(u, f + 1, 0))
        break
      }
    while (pr(u.d, (i += 10), d))
  return (N = !0), _(u, f, d)
}
v.minus = v.sub = function (e) {
  var t,
    r,
    n,
    i,
    o,
    s,
    l,
    u,
    c,
    p,
    f,
    d,
    m = this,
    h = m.constructor
  if (((e = new h(e)), !m.d || !e.d))
    return (
      !m.s || !e.s
        ? (e = new h(NaN))
        : m.d
        ? (e.s = -e.s)
        : (e = new h(e.d || m.s !== e.s ? m : NaN)),
      e
    )
  if (m.s != e.s) return (e.s = -e.s), m.plus(e)
  if (
    ((c = m.d), (d = e.d), (l = h.precision), (u = h.rounding), !c[0] || !d[0])
  ) {
    if (d[0]) e.s = -e.s
    else if (c[0]) e = new h(m)
    else return new h(u === 3 ? -0 : 0)
    return N ? _(e, l, u) : e
  }
  if (((r = ne(e.e / M)), (p = ne(m.e / M)), (c = c.slice()), (o = p - r), o)) {
    for (
      f = o < 0,
        f
          ? ((t = c), (o = -o), (s = d.length))
          : ((t = d), (r = p), (s = c.length)),
        n = Math.max(Math.ceil(l / M), s) + 2,
        o > n && ((o = n), (t.length = 1)),
        t.reverse(),
        n = o;
      n--;

    )
      t.push(0)
    t.reverse()
  } else {
    for (n = c.length, s = d.length, f = n < s, f && (s = n), n = 0; n < s; n++)
      if (c[n] != d[n]) {
        f = c[n] < d[n]
        break
      }
    o = 0
  }
  for (
    f && ((t = c), (c = d), (d = t), (e.s = -e.s)),
      s = c.length,
      n = d.length - s;
    n > 0;
    --n
  )
    c[s++] = 0
  for (n = d.length; n > o; ) {
    if (c[--n] < d[n]) {
      for (i = n; i && c[--i] === 0; ) c[i] = Ce - 1
      --c[i], (c[n] += Ce)
    }
    c[n] -= d[n]
  }
  for (; c[--s] === 0; ) c.pop()
  for (; c[0] === 0; c.shift()) --r
  return c[0]
    ? ((e.d = c), (e.e = Mn(c, r)), N ? _(e, l, u) : e)
    : new h(u === 3 ? -0 : 0)
}
v.modulo = v.mod = function (e) {
  var t,
    r = this,
    n = r.constructor
  return (
    (e = new n(e)),
    !r.d || !e.s || (e.d && !e.d[0])
      ? new n(NaN)
      : !e.d || (r.d && !r.d[0])
      ? _(new n(r), n.precision, n.rounding)
      : ((N = !1),
        n.modulo == 9
          ? ((t = L(r, e.abs(), 0, 3, 1)), (t.s *= e.s))
          : (t = L(r, e, 0, n.modulo, 1)),
        (t = t.times(e)),
        (N = !0),
        r.minus(t))
  )
}
v.naturalExponential = v.exp = function () {
  return Xi(this)
}
v.naturalLogarithm = v.ln = function () {
  return He(this)
}
v.negated = v.neg = function () {
  var e = new this.constructor(this)
  return (e.s = -e.s), _(e)
}
v.plus = v.add = function (e) {
  var t,
    r,
    n,
    i,
    o,
    s,
    l,
    u,
    c,
    p,
    f = this,
    d = f.constructor
  if (((e = new d(e)), !f.d || !e.d))
    return (
      !f.s || !e.s
        ? (e = new d(NaN))
        : f.d || (e = new d(e.d || f.s === e.s ? f : NaN)),
      e
    )
  if (f.s != e.s) return (e.s = -e.s), f.minus(e)
  if (
    ((c = f.d), (p = e.d), (l = d.precision), (u = d.rounding), !c[0] || !p[0])
  )
    return p[0] || (e = new d(f)), N ? _(e, l, u) : e
  if (((o = ne(f.e / M)), (n = ne(e.e / M)), (c = c.slice()), (i = o - n), i)) {
    for (
      i < 0
        ? ((r = c), (i = -i), (s = p.length))
        : ((r = p), (n = o), (s = c.length)),
        o = Math.ceil(l / M),
        s = o > s ? o + 1 : s + 1,
        i > s && ((i = s), (r.length = 1)),
        r.reverse();
      i--;

    )
      r.push(0)
    r.reverse()
  }
  for (
    s = c.length,
      i = p.length,
      s - i < 0 && ((i = s), (r = p), (p = c), (c = r)),
      t = 0;
    i;

  )
    (t = ((c[--i] = c[i] + p[i] + t) / Ce) | 0), (c[i] %= Ce)
  for (t && (c.unshift(t), ++n), s = c.length; c[--s] == 0; ) c.pop()
  return (e.d = c), (e.e = Mn(c, n)), N ? _(e, l, u) : e
}
v.precision = v.sd = function (e) {
  var t,
    r = this
  if (e !== void 0 && e !== !!e && e !== 1 && e !== 0) throw Error(Ye + e)
  return r.d ? ((t = oa(r.d)), e && r.e + 1 > t && (t = r.e + 1)) : (t = NaN), t
}
v.round = function () {
  var e = this,
    t = e.constructor
  return _(new t(e), e.e + 1, t.rounding)
}
v.sine = v.sin = function () {
  var e,
    t,
    r = this,
    n = r.constructor
  return r.isFinite()
    ? r.isZero()
      ? new n(r)
      : ((e = n.precision),
        (t = n.rounding),
        (n.precision = e + Math.max(r.e, r.sd()) + M),
        (n.rounding = 1),
        (r = Vp(n, ua(n, r))),
        (n.precision = e),
        (n.rounding = t),
        _(Be > 2 ? r.neg() : r, e, t, !0))
    : new n(NaN)
}
v.squareRoot = v.sqrt = function () {
  var e,
    t,
    r,
    n,
    i,
    o,
    s = this,
    l = s.d,
    u = s.e,
    c = s.s,
    p = s.constructor
  if (c !== 1 || !l || !l[0])
    return new p(!c || (c < 0 && (!l || l[0])) ? NaN : l ? s : 1 / 0)
  for (
    N = !1,
      c = Math.sqrt(+s),
      c == 0 || c == 1 / 0
        ? ((t = H(l)),
          (t.length + u) % 2 == 0 && (t += '0'),
          (c = Math.sqrt(t)),
          (u = ne((u + 1) / 2) - (u < 0 || u % 2)),
          c == 1 / 0
            ? (t = '5e' + u)
            : ((t = c.toExponential()),
              (t = t.slice(0, t.indexOf('e') + 1) + u)),
          (n = new p(t)))
        : (n = new p(c.toString())),
      r = (u = p.precision) + 3;
    ;

  )
    if (
      ((o = n),
      (n = o.plus(L(s, o, r + 2, 1)).times(0.5)),
      H(o.d).slice(0, r) === (t = H(n.d)).slice(0, r))
    )
      if (((t = t.slice(r - 3, r + 1)), t == '9999' || (!i && t == '4999'))) {
        if (!i && (_(o, u + 1, 0), o.times(o).eq(s))) {
          n = o
          break
        }
        ;(r += 4), (i = 1)
      } else {
        ;(!+t || (!+t.slice(1) && t.charAt(0) == '5')) &&
          (_(n, u + 1, 1), (e = !n.times(n).eq(s)))
        break
      }
  return (N = !0), _(n, u, p.rounding, e)
}
v.tangent = v.tan = function () {
  var e,
    t,
    r = this,
    n = r.constructor
  return r.isFinite()
    ? r.isZero()
      ? new n(r)
      : ((e = n.precision),
        (t = n.rounding),
        (n.precision = e + 10),
        (n.rounding = 1),
        (r = r.sin()),
        (r.s = 1),
        (r = L(r, new n(1).minus(r.times(r)).sqrt(), e + 10, 0)),
        (n.precision = e),
        (n.rounding = t),
        _(Be == 2 || Be == 4 ? r.neg() : r, e, t, !0))
    : new n(NaN)
}
v.times = v.mul = function (e) {
  var t,
    r,
    n,
    i,
    o,
    s,
    l,
    u,
    c,
    p = this,
    f = p.constructor,
    d = p.d,
    m = (e = new f(e)).d
  if (((e.s *= p.s), !d || !d[0] || !m || !m[0]))
    return new f(
      !e.s || (d && !d[0] && !m) || (m && !m[0] && !d)
        ? NaN
        : !d || !m
        ? e.s / 0
        : e.s * 0
    )
  for (
    r = ne(p.e / M) + ne(e.e / M),
      u = d.length,
      c = m.length,
      u < c && ((o = d), (d = m), (m = o), (s = u), (u = c), (c = s)),
      o = [],
      s = u + c,
      n = s;
    n--;

  )
    o.push(0)
  for (n = c; --n >= 0; ) {
    for (t = 0, i = u + n; i > n; )
      (l = o[i] + m[n] * d[i - n - 1] + t),
        (o[i--] = l % Ce | 0),
        (t = (l / Ce) | 0)
    o[i] = (o[i] + t) % Ce | 0
  }
  for (; !o[--s]; ) o.pop()
  return (
    t ? ++r : o.shift(),
    (e.d = o),
    (e.e = Mn(o, r)),
    N ? _(e, f.precision, f.rounding) : e
  )
}
v.toBinary = function (e, t) {
  return eo(this, 2, e, t)
}
v.toDecimalPlaces = v.toDP = function (e, t) {
  var r = this,
    n = r.constructor
  return (
    (r = new n(r)),
    e === void 0
      ? r
      : (pe(e, 0, ze),
        t === void 0 ? (t = n.rounding) : pe(t, 0, 8),
        _(r, e + r.e + 1, t))
  )
}
v.toExponential = function (e, t) {
  var r,
    n = this,
    i = n.constructor
  return (
    e === void 0
      ? (r = Fe(n, !0))
      : (pe(e, 0, ze),
        t === void 0 ? (t = i.rounding) : pe(t, 0, 8),
        (n = _(new i(n), e + 1, t)),
        (r = Fe(n, !0, e + 1))),
    n.isNeg() && !n.isZero() ? '-' + r : r
  )
}
v.toFixed = function (e, t) {
  var r,
    n,
    i = this,
    o = i.constructor
  return (
    e === void 0
      ? (r = Fe(i))
      : (pe(e, 0, ze),
        t === void 0 ? (t = o.rounding) : pe(t, 0, 8),
        (n = _(new o(i), e + i.e + 1, t)),
        (r = Fe(n, !1, e + n.e + 1))),
    i.isNeg() && !i.isZero() ? '-' + r : r
  )
}
v.toFraction = function (e) {
  var t,
    r,
    n,
    i,
    o,
    s,
    l,
    u,
    c,
    p,
    f,
    d,
    m = this,
    h = m.d,
    g = m.constructor
  if (!h) return new g(m)
  if (
    ((c = r = new g(1)),
    (n = u = new g(0)),
    (t = new g(n)),
    (o = t.e = oa(h) - m.e - 1),
    (s = o % M),
    (t.d[0] = Q(10, s < 0 ? M + s : s)),
    e == null)
  )
    e = o > 0 ? t : c
  else {
    if (((l = new g(e)), !l.isInt() || l.lt(c))) throw Error(Ye + l)
    e = l.gt(t) ? (o > 0 ? t : c) : l
  }
  for (
    N = !1,
      l = new g(H(h)),
      p = g.precision,
      g.precision = o = h.length * M * 2;
    (f = L(l, t, 0, 1, 1)), (i = r.plus(f.times(n))), i.cmp(e) != 1;

  )
    (r = n),
      (n = i),
      (i = c),
      (c = u.plus(f.times(i))),
      (u = i),
      (i = t),
      (t = l.minus(f.times(i))),
      (l = i)
  return (
    (i = L(e.minus(r), n, 0, 1, 1)),
    (u = u.plus(i.times(c))),
    (r = r.plus(i.times(n))),
    (u.s = c.s = m.s),
    (d =
      L(c, n, o, 1).minus(m).abs().cmp(L(u, r, o, 1).minus(m).abs()) < 1
        ? [c, n]
        : [u, r]),
    (g.precision = p),
    (N = !0),
    d
  )
}
v.toHexadecimal = v.toHex = function (e, t) {
  return eo(this, 16, e, t)
}
v.toNearest = function (e, t) {
  var r = this,
    n = r.constructor
  if (((r = new n(r)), e == null)) {
    if (!r.d) return r
    ;(e = new n(1)), (t = n.rounding)
  } else {
    if (((e = new n(e)), t === void 0 ? (t = n.rounding) : pe(t, 0, 8), !r.d))
      return e.s ? r : e
    if (!e.d) return e.s && (e.s = r.s), e
  }
  return (
    e.d[0]
      ? ((N = !1), (r = L(r, e, 0, t, 1).times(e)), (N = !0), _(r))
      : ((e.s = r.s), (r = e)),
    r
  )
}
v.toNumber = function () {
  return +this
}
v.toOctal = function (e, t) {
  return eo(this, 8, e, t)
}
v.toPower = v.pow = function (e) {
  var t,
    r,
    n,
    i,
    o,
    s,
    l = this,
    u = l.constructor,
    c = +(e = new u(e))
  if (!l.d || !e.d || !l.d[0] || !e.d[0]) return new u(Q(+l, c))
  if (((l = new u(l)), l.eq(1))) return l
  if (((n = u.precision), (o = u.rounding), e.eq(1))) return _(l, n, o)
  if (((t = ne(e.e / M)), t >= e.d.length - 1 && (r = c < 0 ? -c : c) <= Lp))
    return (i = sa(u, l, r, n)), e.s < 0 ? new u(1).div(i) : _(i, n, o)
  if (((s = l.s), s < 0)) {
    if (t < e.d.length - 1) return new u(NaN)
    if (
      ((e.d[t] & 1) == 0 && (s = 1), l.e == 0 && l.d[0] == 1 && l.d.length == 1)
    )
      return (l.s = s), l
  }
  return (
    (r = Q(+l, c)),
    (t =
      r == 0 || !isFinite(r)
        ? ne(c * (Math.log('0.' + H(l.d)) / Math.LN10 + l.e + 1))
        : new u(r + '').e),
    t > u.maxE + 1 || t < u.minE - 1
      ? new u(t > 0 ? s / 0 : 0)
      : ((N = !1),
        (u.rounding = l.s = 1),
        (r = Math.min(12, (t + '').length)),
        (i = Xi(e.times(He(l, n + r)), n)),
        i.d &&
          ((i = _(i, n + 5, 1)),
          pr(i.d, n, o) &&
            ((t = n + 10),
            (i = _(Xi(e.times(He(l, t + r)), t), t + 5, 1)),
            +H(i.d).slice(n + 1, n + 15) + 1 == 1e14 && (i = _(i, n + 1, 0)))),
        (i.s = s),
        (N = !0),
        (u.rounding = o),
        _(i, n, o))
  )
}
v.toPrecision = function (e, t) {
  var r,
    n = this,
    i = n.constructor
  return (
    e === void 0
      ? (r = Fe(n, n.e <= i.toExpNeg || n.e >= i.toExpPos))
      : (pe(e, 1, ze),
        t === void 0 ? (t = i.rounding) : pe(t, 0, 8),
        (n = _(new i(n), e, t)),
        (r = Fe(n, e <= n.e || n.e <= i.toExpNeg, e))),
    n.isNeg() && !n.isZero() ? '-' + r : r
  )
}
v.toSignificantDigits = v.toSD = function (e, t) {
  var r = this,
    n = r.constructor
  return (
    e === void 0
      ? ((e = n.precision), (t = n.rounding))
      : (pe(e, 1, ze), t === void 0 ? (t = n.rounding) : pe(t, 0, 8)),
    _(new n(r), e, t)
  )
}
v.toString = function () {
  var e = this,
    t = e.constructor,
    r = Fe(e, e.e <= t.toExpNeg || e.e >= t.toExpPos)
  return e.isNeg() && !e.isZero() ? '-' + r : r
}
v.truncated = v.trunc = function () {
  return _(new this.constructor(this), this.e + 1, 1)
}
v.valueOf = v.toJSON = function () {
  var e = this,
    t = e.constructor,
    r = Fe(e, e.e <= t.toExpNeg || e.e >= t.toExpPos)
  return e.isNeg() ? '-' + r : r
}
function H(e) {
  var t,
    r,
    n,
    i = e.length - 1,
    o = '',
    s = e[0]
  if (i > 0) {
    for (o += s, t = 1; t < i; t++)
      (n = e[t] + ''), (r = M - n.length), r && (o += Je(r)), (o += n)
    ;(s = e[t]), (n = s + ''), (r = M - n.length), r && (o += Je(r))
  } else if (s === 0) return '0'
  for (; s % 10 === 0; ) s /= 10
  return o + s
}
a(H, 'digitsToString')
function pe(e, t, r) {
  if (e !== ~~e || e < t || e > r) throw Error(Ye + e)
}
a(pe, 'checkInt32')
function pr(e, t, r, n) {
  var i, o, s, l
  for (o = e[0]; o >= 10; o /= 10) --t
  return (
    --t < 0 ? ((t += M), (i = 0)) : ((i = Math.ceil((t + 1) / M)), (t %= M)),
    (o = Q(10, M - t)),
    (l = e[i] % o | 0),
    n == null
      ? t < 3
        ? (t == 0 ? (l = (l / 100) | 0) : t == 1 && (l = (l / 10) | 0),
          (s =
            (r < 4 && l == 99999) ||
            (r > 3 && l == 49999) ||
            l == 5e4 ||
            l == 0))
        : (s =
            (((r < 4 && l + 1 == o) || (r > 3 && l + 1 == o / 2)) &&
              ((e[i + 1] / o / 100) | 0) == Q(10, t - 2) - 1) ||
            ((l == o / 2 || l == 0) && ((e[i + 1] / o / 100) | 0) == 0))
      : t < 4
      ? (t == 0
          ? (l = (l / 1e3) | 0)
          : t == 1
          ? (l = (l / 100) | 0)
          : t == 2 && (l = (l / 10) | 0),
        (s = ((n || r < 4) && l == 9999) || (!n && r > 3 && l == 4999)))
      : (s =
          (((n || r < 4) && l + 1 == o) || (!n && r > 3 && l + 1 == o / 2)) &&
          ((e[i + 1] / o / 1e3) | 0) == Q(10, t - 3) - 1),
    s
  )
}
a(pr, 'checkRoundingDigits')
function Sn(e, t, r) {
  for (var n, i = [0], o, s = 0, l = e.length; s < l; ) {
    for (o = i.length; o--; ) i[o] *= t
    for (i[0] += Hi.indexOf(e.charAt(s++)), n = 0; n < i.length; n++)
      i[n] > r - 1 &&
        (i[n + 1] === void 0 && (i[n + 1] = 0),
        (i[n + 1] += (i[n] / r) | 0),
        (i[n] %= r))
  }
  return i.reverse()
}
a(Sn, 'convertBase')
function Bp(e, t) {
  var r, n, i
  if (t.isZero()) return t
  ;(n = t.d.length),
    n < 32
      ? ((r = Math.ceil(n / 3)), (i = (1 / Nn(4, r)).toString()))
      : ((r = 16), (i = '2.3283064365386962890625e-10')),
    (e.precision += r),
    (t = Mt(e, 1, t.times(i), new e(1)))
  for (var o = r; o--; ) {
    var s = t.times(t)
    t = s.times(s).minus(s).times(8).plus(1)
  }
  return (e.precision -= r), t
}
a(Bp, 'cosine')
var L = (function () {
  function e(n, i, o) {
    var s,
      l = 0,
      u = n.length
    for (n = n.slice(); u--; )
      (s = n[u] * i + l), (n[u] = s % o | 0), (l = (s / o) | 0)
    return l && n.unshift(l), n
  }
  a(e, 'multiplyInteger')
  function t(n, i, o, s) {
    var l, u
    if (o != s) u = o > s ? 1 : -1
    else
      for (l = u = 0; l < o; l++)
        if (n[l] != i[l]) {
          u = n[l] > i[l] ? 1 : -1
          break
        }
    return u
  }
  a(t, 'compare')
  function r(n, i, o, s) {
    for (var l = 0; o--; )
      (n[o] -= l), (l = n[o] < i[o] ? 1 : 0), (n[o] = l * s + n[o] - i[o])
    for (; !n[0] && n.length > 1; ) n.shift()
  }
  return (
    a(r, 'subtract'),
    function (n, i, o, s, l, u) {
      var c,
        p,
        f,
        d,
        m,
        h,
        g,
        b,
        y,
        x,
        E,
        w,
        T,
        C,
        S,
        D,
        q,
        V,
        te,
        At,
        mn = n.constructor,
        Di = n.s == i.s ? 1 : -1,
        re = n.d,
        $ = i.d
      if (!re || !re[0] || !$ || !$[0])
        return new mn(
          !n.s || !i.s || (re ? $ && re[0] == $[0] : !$)
            ? NaN
            : (re && re[0] == 0) || !$
            ? Di * 0
            : Di / 0
        )
      for (
        u
          ? ((m = 1), (p = n.e - i.e))
          : ((u = Ce), (m = M), (p = ne(n.e / m) - ne(i.e / m))),
          te = $.length,
          q = re.length,
          y = new mn(Di),
          x = y.d = [],
          f = 0;
        $[f] == (re[f] || 0);
        f++
      );
      if (
        ($[f] > (re[f] || 0) && p--,
        o == null
          ? ((C = o = mn.precision), (s = mn.rounding))
          : l
          ? (C = o + (n.e - i.e) + 1)
          : (C = o),
        C < 0)
      )
        x.push(1), (h = !0)
      else {
        if (((C = (C / m + 2) | 0), (f = 0), te == 1)) {
          for (d = 0, $ = $[0], C++; (f < q || d) && C--; f++)
            (S = d * u + (re[f] || 0)), (x[f] = (S / $) | 0), (d = S % $ | 0)
          h = d || f < q
        } else {
          for (
            d = (u / ($[0] + 1)) | 0,
              d > 1 &&
                (($ = e($, d, u)),
                (re = e(re, d, u)),
                (te = $.length),
                (q = re.length)),
              D = te,
              E = re.slice(0, te),
              w = E.length;
            w < te;

          )
            E[w++] = 0
          ;(At = $.slice()), At.unshift(0), (V = $[0]), $[1] >= u / 2 && ++V
          do
            (d = 0),
              (c = t($, E, te, w)),
              c < 0
                ? ((T = E[0]),
                  te != w && (T = T * u + (E[1] || 0)),
                  (d = (T / V) | 0),
                  d > 1
                    ? (d >= u && (d = u - 1),
                      (g = e($, d, u)),
                      (b = g.length),
                      (w = E.length),
                      (c = t(g, E, b, w)),
                      c == 1 && (d--, r(g, te < b ? At : $, b, u)))
                    : (d == 0 && (c = d = 1), (g = $.slice())),
                  (b = g.length),
                  b < w && g.unshift(0),
                  r(E, g, w, u),
                  c == -1 &&
                    ((w = E.length),
                    (c = t($, E, te, w)),
                    c < 1 && (d++, r(E, te < w ? At : $, w, u))),
                  (w = E.length))
                : c === 0 && (d++, (E = [0])),
              (x[f++] = d),
              c && E[0] ? (E[w++] = re[D] || 0) : ((E = [re[D]]), (w = 1))
          while ((D++ < q || E[0] !== void 0) && C--)
          h = E[0] !== void 0
        }
        x[0] || x.shift()
      }
      if (m == 1) (y.e = p), (ea = h)
      else {
        for (f = 1, d = x[0]; d >= 10; d /= 10) f++
        ;(y.e = f + p * m - 1), _(y, l ? o + y.e + 1 : o, s, h)
      }
      return y
    }
  )
})()
function _(e, t, r, n) {
  var i,
    o,
    s,
    l,
    u,
    c,
    p,
    f,
    d,
    m = e.constructor
  e: if (t != null) {
    if (((f = e.d), !f)) return e
    for (i = 1, l = f[0]; l >= 10; l /= 10) i++
    if (((o = t - i), o < 0))
      (o += M), (s = t), (p = f[(d = 0)]), (u = (p / Q(10, i - s - 1)) % 10 | 0)
    else if (((d = Math.ceil((o + 1) / M)), (l = f.length), d >= l))
      if (n) {
        for (; l++ <= d; ) f.push(0)
        ;(p = u = 0), (i = 1), (o %= M), (s = o - M + 1)
      } else break e
    else {
      for (p = l = f[d], i = 1; l >= 10; l /= 10) i++
      ;(o %= M),
        (s = o - M + i),
        (u = s < 0 ? 0 : (p / Q(10, i - s - 1)) % 10 | 0)
    }
    if (
      ((n =
        n ||
        t < 0 ||
        f[d + 1] !== void 0 ||
        (s < 0 ? p : p % Q(10, i - s - 1))),
      (c =
        r < 4
          ? (u || n) && (r == 0 || r == (e.s < 0 ? 3 : 2))
          : u > 5 ||
            (u == 5 &&
              (r == 4 ||
                n ||
                (r == 6 &&
                  (o > 0 ? (s > 0 ? p / Q(10, i - s) : 0) : f[d - 1]) % 10 &
                    1) ||
                r == (e.s < 0 ? 8 : 7)))),
      t < 1 || !f[0])
    )
      return (
        (f.length = 0),
        c
          ? ((t -= e.e + 1), (f[0] = Q(10, (M - (t % M)) % M)), (e.e = -t || 0))
          : (f[0] = e.e = 0),
        e
      )
    if (
      (o == 0
        ? ((f.length = d), (l = 1), d--)
        : ((f.length = d + 1),
          (l = Q(10, M - o)),
          (f[d] = s > 0 ? ((p / Q(10, i - s)) % Q(10, s) | 0) * l : 0)),
      c)
    )
      for (;;)
        if (d == 0) {
          for (o = 1, s = f[0]; s >= 10; s /= 10) o++
          for (s = f[0] += l, l = 1; s >= 10; s /= 10) l++
          o != l && (e.e++, f[0] == Ce && (f[0] = 1))
          break
        } else {
          if (((f[d] += l), f[d] != Ce)) break
          ;(f[d--] = 0), (l = 1)
        }
    for (o = f.length; f[--o] === 0; ) f.pop()
  }
  return (
    N &&
      (e.e > m.maxE
        ? ((e.d = null), (e.e = NaN))
        : e.e < m.minE && ((e.e = 0), (e.d = [0]))),
    e
  )
}
a(_, 'finalise')
function Fe(e, t, r) {
  if (!e.isFinite()) return la(e)
  var n,
    i = e.e,
    o = H(e.d),
    s = o.length
  return (
    t
      ? (r && (n = r - s) > 0
          ? (o = o.charAt(0) + '.' + o.slice(1) + Je(n))
          : s > 1 && (o = o.charAt(0) + '.' + o.slice(1)),
        (o = o + (e.e < 0 ? 'e' : 'e+') + e.e))
      : i < 0
      ? ((o = '0.' + Je(-i - 1) + o), r && (n = r - s) > 0 && (o += Je(n)))
      : i >= s
      ? ((o += Je(i + 1 - s)),
        r && (n = r - i - 1) > 0 && (o = o + '.' + Je(n)))
      : ((n = i + 1) < s && (o = o.slice(0, n) + '.' + o.slice(n)),
        r && (n = r - s) > 0 && (i + 1 === s && (o += '.'), (o += Je(n)))),
    o
  )
}
a(Fe, 'finiteToString')
function Mn(e, t) {
  var r = e[0]
  for (t *= M; r >= 10; r /= 10) t++
  return t
}
a(Mn, 'getBase10Exponent')
function Cn(e, t, r) {
  if (t > jp) throw ((N = !0), r && (e.precision = r), Error(ta))
  return _(new e(Pn), t, 1, !0)
}
a(Cn, 'getLn10')
function _e(e, t, r) {
  if (t > zi) throw Error(ta)
  return _(new e(_n), t, r, !0)
}
a(_e, 'getPi')
function oa(e) {
  var t = e.length - 1,
    r = t * M + 1
  if (((t = e[t]), t)) {
    for (; t % 10 == 0; t /= 10) r--
    for (t = e[0]; t >= 10; t /= 10) r++
  }
  return r
}
a(oa, 'getPrecision')
function Je(e) {
  for (var t = ''; e--; ) t += '0'
  return t
}
a(Je, 'getZeroString')
function sa(e, t, r, n) {
  var i,
    o = new e(1),
    s = Math.ceil(n / M + 4)
  for (N = !1; ; ) {
    if (
      (r % 2 && ((o = o.times(t)), Xs(o.d, s) && (i = !0)),
      (r = ne(r / 2)),
      r === 0)
    ) {
      ;(r = o.d.length - 1), i && o.d[r] === 0 && ++o.d[r]
      break
    }
    ;(t = t.times(t)), Xs(t.d, s)
  }
  return (N = !0), o
}
a(sa, 'intPow')
function zs(e) {
  return e.d[e.d.length - 1] & 1
}
a(zs, 'isOdd')
function aa(e, t, r) {
  for (var n, i = new e(t[0]), o = 0; ++o < t.length; )
    if (((n = new e(t[o])), n.s)) i[r](n) && (i = n)
    else {
      i = n
      break
    }
  return i
}
a(aa, 'maxOrMin')
function Xi(e, t) {
  var r,
    n,
    i,
    o,
    s,
    l,
    u,
    c = 0,
    p = 0,
    f = 0,
    d = e.constructor,
    m = d.rounding,
    h = d.precision
  if (!e.d || !e.d[0] || e.e > 17)
    return new d(
      e.d
        ? e.d[0]
          ? e.s < 0
            ? 0
            : 1 / 0
          : 1
        : e.s
        ? e.s < 0
          ? 0
          : e
        : 0 / 0
    )
  for (
    t == null ? ((N = !1), (u = h)) : (u = t), l = new d(0.03125);
    e.e > -2;

  )
    (e = e.times(l)), (f += 5)
  for (
    n = ((Math.log(Q(2, f)) / Math.LN10) * 2 + 5) | 0,
      u += n,
      r = o = s = new d(1),
      d.precision = u;
    ;

  ) {
    if (
      ((o = _(o.times(e), u, 1)),
      (r = r.times(++p)),
      (l = s.plus(L(o, r, u, 1))),
      H(l.d).slice(0, u) === H(s.d).slice(0, u))
    ) {
      for (i = f; i--; ) s = _(s.times(s), u, 1)
      if (t == null)
        if (c < 3 && pr(s.d, u - n, m, c))
          (d.precision = u += 10), (r = o = l = new d(1)), (p = 0), c++
        else return _(s, (d.precision = h), m, (N = !0))
      else return (d.precision = h), s
    }
    s = l
  }
}
a(Xi, 'naturalExponential')
function He(e, t) {
  var r,
    n,
    i,
    o,
    s,
    l,
    u,
    c,
    p,
    f,
    d,
    m = 1,
    h = 10,
    g = e,
    b = g.d,
    y = g.constructor,
    x = y.rounding,
    E = y.precision
  if (g.s < 0 || !b || !b[0] || (!g.e && b[0] == 1 && b.length == 1))
    return new y(b && !b[0] ? -1 / 0 : g.s != 1 ? NaN : b ? 0 : g)
  if (
    (t == null ? ((N = !1), (p = E)) : (p = t),
    (y.precision = p += h),
    (r = H(b)),
    (n = r.charAt(0)),
    Math.abs((o = g.e)) < 15e14)
  ) {
    for (; (n < 7 && n != 1) || (n == 1 && r.charAt(1) > 3); )
      (g = g.times(e)), (r = H(g.d)), (n = r.charAt(0)), m++
    ;(o = g.e),
      n > 1 ? ((g = new y('0.' + r)), o++) : (g = new y(n + '.' + r.slice(1)))
  } else
    return (
      (c = Cn(y, p + 2, E).times(o + '')),
      (g = He(new y(n + '.' + r.slice(1)), p - h).plus(c)),
      (y.precision = E),
      t == null ? _(g, E, x, (N = !0)) : g
    )
  for (
    f = g,
      u = s = g = L(g.minus(1), g.plus(1), p, 1),
      d = _(g.times(g), p, 1),
      i = 3;
    ;

  ) {
    if (
      ((s = _(s.times(d), p, 1)),
      (c = u.plus(L(s, new y(i), p, 1))),
      H(c.d).slice(0, p) === H(u.d).slice(0, p))
    )
      if (
        ((u = u.times(2)),
        o !== 0 && (u = u.plus(Cn(y, p + 2, E).times(o + ''))),
        (u = L(u, new y(m), p, 1)),
        t == null)
      )
        if (pr(u.d, p - h, x, l))
          (y.precision = p += h),
            (c = s = g = L(f.minus(1), f.plus(1), p, 1)),
            (d = _(g.times(g), p, 1)),
            (i = l = 1)
        else return _(u, (y.precision = E), x, (N = !0))
      else return (y.precision = E), u
    ;(u = c), (i += 2)
  }
}
a(He, 'naturalLogarithm')
function la(e) {
  return String((e.s * e.s) / 0)
}
a(la, 'nonFiniteToString')
function Zi(e, t) {
  var r, n, i
  for (
    (r = t.indexOf('.')) > -1 && (t = t.replace('.', '')),
      (n = t.search(/e/i)) > 0
        ? (r < 0 && (r = n), (r += +t.slice(n + 1)), (t = t.substring(0, n)))
        : r < 0 && (r = t.length),
      n = 0;
    t.charCodeAt(n) === 48;
    n++
  );
  for (i = t.length; t.charCodeAt(i - 1) === 48; --i);
  if (((t = t.slice(n, i)), t)) {
    if (
      ((i -= n),
      (e.e = r = r - n - 1),
      (e.d = []),
      (n = (r + 1) % M),
      r < 0 && (n += M),
      n < i)
    ) {
      for (n && e.d.push(+t.slice(0, n)), i -= M; n < i; )
        e.d.push(+t.slice(n, (n += M)))
      ;(t = t.slice(n)), (n = M - t.length)
    } else n -= i
    for (; n--; ) t += '0'
    e.d.push(+t),
      N &&
        (e.e > e.constructor.maxE
          ? ((e.d = null), (e.e = NaN))
          : e.e < e.constructor.minE && ((e.e = 0), (e.d = [0])))
  } else (e.e = 0), (e.d = [0])
  return e
}
a(Zi, 'parseDecimal')
function qp(e, t) {
  var r, n, i, o, s, l, u, c, p
  if (t.indexOf('_') > -1) {
    if (((t = t.replace(/(\d)_(?=\d)/g, '$1')), ia.test(t))) return Zi(e, t)
  } else if (t === 'Infinity' || t === 'NaN')
    return +t || (e.s = NaN), (e.e = NaN), (e.d = null), e
  if (kp.test(t)) (r = 16), (t = t.toLowerCase())
  else if (Dp.test(t)) r = 2
  else if ($p.test(t)) r = 8
  else throw Error(Ye + t)
  for (
    o = t.search(/p/i),
      o > 0
        ? ((u = +t.slice(o + 1)), (t = t.substring(2, o)))
        : (t = t.slice(2)),
      o = t.indexOf('.'),
      s = o >= 0,
      n = e.constructor,
      s &&
        ((t = t.replace('.', '')),
        (l = t.length),
        (o = l - o),
        (i = sa(n, new n(r), o, o * 2))),
      c = Sn(t, r, Ce),
      p = c.length - 1,
      o = p;
    c[o] === 0;
    --o
  )
    c.pop()
  return o < 0
    ? new n(e.s * 0)
    : ((e.e = Mn(c, p)),
      (e.d = c),
      (N = !1),
      s && (e = L(e, i, l * 4)),
      u && (e = e.times(Math.abs(u) < 54 ? Q(2, u) : gt.pow(2, u))),
      (N = !0),
      e)
}
a(qp, 'parseOther')
function Vp(e, t) {
  var r,
    n = t.d.length
  if (n < 3) return t.isZero() ? t : Mt(e, 2, t, t)
  ;(r = 1.4 * Math.sqrt(n)),
    (r = r > 16 ? 16 : r | 0),
    (t = t.times(1 / Nn(5, r))),
    (t = Mt(e, 2, t, t))
  for (var i, o = new e(5), s = new e(16), l = new e(20); r--; )
    (i = t.times(t)), (t = t.times(o.plus(i.times(s.times(i).minus(l)))))
  return t
}
a(Vp, 'sine')
function Mt(e, t, r, n, i) {
  var o,
    s,
    l,
    u,
    c = 1,
    p = e.precision,
    f = Math.ceil(p / M)
  for (N = !1, u = r.times(r), l = new e(n); ; ) {
    if (
      ((s = L(l.times(u), new e(t++ * t++), p, 1)),
      (l = i ? n.plus(s) : n.minus(s)),
      (n = L(s.times(u), new e(t++ * t++), p, 1)),
      (s = l.plus(n)),
      s.d[f] !== void 0)
    ) {
      for (o = f; s.d[o] === l.d[o] && o--; );
      if (o == -1) break
    }
    ;(o = l), (l = n), (n = s), (s = o), c++
  }
  return (N = !0), (s.d.length = f + 1), s
}
a(Mt, 'taylorSeries')
function Nn(e, t) {
  for (var r = e; --t; ) r *= e
  return r
}
a(Nn, 'tinyPow')
function ua(e, t) {
  var r,
    n = t.s < 0,
    i = _e(e, e.precision, 1),
    o = i.times(0.5)
  if (((t = t.abs()), t.lte(o))) return (Be = n ? 4 : 1), t
  if (((r = t.divToInt(i)), r.isZero())) Be = n ? 3 : 2
  else {
    if (((t = t.minus(r.times(i))), t.lte(o)))
      return (Be = zs(r) ? (n ? 2 : 3) : n ? 4 : 1), t
    Be = zs(r) ? (n ? 1 : 4) : n ? 3 : 2
  }
  return t.minus(i).abs()
}
a(ua, 'toLessThanHalfPi')
function eo(e, t, r, n) {
  var i,
    o,
    s,
    l,
    u,
    c,
    p,
    f,
    d,
    m = e.constructor,
    h = r !== void 0
  if (
    (h
      ? (pe(r, 1, ze), n === void 0 ? (n = m.rounding) : pe(n, 0, 8))
      : ((r = m.precision), (n = m.rounding)),
    !e.isFinite())
  )
    p = la(e)
  else {
    for (
      p = Fe(e),
        s = p.indexOf('.'),
        h
          ? ((i = 2), t == 16 ? (r = r * 4 - 3) : t == 8 && (r = r * 3 - 2))
          : (i = t),
        s >= 0 &&
          ((p = p.replace('.', '')),
          (d = new m(1)),
          (d.e = p.length - s),
          (d.d = Sn(Fe(d), 10, i)),
          (d.e = d.d.length)),
        f = Sn(p, 10, i),
        o = u = f.length;
      f[--u] == 0;

    )
      f.pop()
    if (!f[0]) p = h ? '0p+0' : '0'
    else {
      if (
        (s < 0
          ? o--
          : ((e = new m(e)),
            (e.d = f),
            (e.e = o),
            (e = L(e, d, r, n, 0, i)),
            (f = e.d),
            (o = e.e),
            (c = ea)),
        (s = f[r]),
        (l = i / 2),
        (c = c || f[r + 1] !== void 0),
        (c =
          n < 4
            ? (s !== void 0 || c) && (n === 0 || n === (e.s < 0 ? 3 : 2))
            : s > l ||
              (s === l &&
                (n === 4 ||
                  c ||
                  (n === 6 && f[r - 1] & 1) ||
                  n === (e.s < 0 ? 8 : 7)))),
        (f.length = r),
        c)
      )
        for (; ++f[--r] > i - 1; ) (f[r] = 0), r || (++o, f.unshift(1))
      for (u = f.length; !f[u - 1]; --u);
      for (s = 0, p = ''; s < u; s++) p += Hi.charAt(f[s])
      if (h) {
        if (u > 1)
          if (t == 16 || t == 8) {
            for (s = t == 16 ? 4 : 3, --u; u % s; u++) p += '0'
            for (f = Sn(p, i, t), u = f.length; !f[u - 1]; --u);
            for (s = 1, p = '1.'; s < u; s++) p += Hi.charAt(f[s])
          } else p = p.charAt(0) + '.' + p.slice(1)
        p = p + (o < 0 ? 'p' : 'p+') + o
      } else if (o < 0) {
        for (; ++o; ) p = '0' + p
        p = '0.' + p
      } else if (++o > u) for (o -= u; o--; ) p += '0'
      else o < u && (p = p.slice(0, o) + '.' + p.slice(o))
    }
    p = (t == 16 ? '0x' : t == 2 ? '0b' : t == 8 ? '0o' : '') + p
  }
  return e.s < 0 ? '-' + p : p
}
a(eo, 'toStringBinary')
function Xs(e, t) {
  if (e.length > t) return (e.length = t), !0
}
a(Xs, 'truncate')
function Up(e) {
  return new this(e).abs()
}
a(Up, 'abs')
function Gp(e) {
  return new this(e).acos()
}
a(Gp, 'acos')
function Qp(e) {
  return new this(e).acosh()
}
a(Qp, 'acosh')
function Kp(e, t) {
  return new this(e).plus(t)
}
a(Kp, 'add')
function Wp(e) {
  return new this(e).asin()
}
a(Wp, 'asin')
function Jp(e) {
  return new this(e).asinh()
}
a(Jp, 'asinh')
function Hp(e) {
  return new this(e).atan()
}
a(Hp, 'atan')
function Yp(e) {
  return new this(e).atanh()
}
a(Yp, 'atanh')
function zp(e, t) {
  ;(e = new this(e)), (t = new this(t))
  var r,
    n = this.precision,
    i = this.rounding,
    o = n + 4
  return (
    !e.s || !t.s
      ? (r = new this(NaN))
      : !e.d && !t.d
      ? ((r = _e(this, o, 1).times(t.s > 0 ? 0.25 : 0.75)), (r.s = e.s))
      : !t.d || e.isZero()
      ? ((r = t.s < 0 ? _e(this, n, i) : new this(0)), (r.s = e.s))
      : !e.d || t.isZero()
      ? ((r = _e(this, o, 1).times(0.5)), (r.s = e.s))
      : t.s < 0
      ? ((this.precision = o),
        (this.rounding = 1),
        (r = this.atan(L(e, t, o, 1))),
        (t = _e(this, o, 1)),
        (this.precision = n),
        (this.rounding = i),
        (r = e.s < 0 ? r.minus(t) : r.plus(t)))
      : (r = this.atan(L(e, t, o, 1))),
    r
  )
}
a(zp, 'atan2')
function Xp(e) {
  return new this(e).cbrt()
}
a(Xp, 'cbrt')
function Zp(e) {
  return _((e = new this(e)), e.e + 1, 2)
}
a(Zp, 'ceil')
function ef(e, t, r) {
  return new this(e).clamp(t, r)
}
a(ef, 'clamp')
function tf(e) {
  if (!e || typeof e != 'object') throw Error(On + 'Object expected')
  var t,
    r,
    n,
    i = e.defaults === !0,
    o = [
      'precision',
      1,
      ze,
      'rounding',
      0,
      8,
      'toExpNeg',
      -Ot,
      0,
      'toExpPos',
      0,
      Ot,
      'maxE',
      0,
      Ot,
      'minE',
      -Ot,
      0,
      'modulo',
      0,
      9,
    ]
  for (t = 0; t < o.length; t += 3)
    if (((r = o[t]), i && (this[r] = Yi[r]), (n = e[r]) !== void 0))
      if (ne(n) === n && n >= o[t + 1] && n <= o[t + 2]) this[r] = n
      else throw Error(Ye + r + ': ' + n)
  if (((r = 'crypto'), i && (this[r] = Yi[r]), (n = e[r]) !== void 0))
    if (n === !0 || n === !1 || n === 0 || n === 1)
      if (n)
        if (
          typeof crypto < 'u' &&
          crypto &&
          (crypto.getRandomValues || crypto.randomBytes)
        )
          this[r] = !0
        else throw Error(ra)
      else this[r] = !1
    else throw Error(Ye + r + ': ' + n)
  return this
}
a(tf, 'config')
function rf(e) {
  return new this(e).cos()
}
a(rf, 'cos')
function nf(e) {
  return new this(e).cosh()
}
a(nf, 'cosh')
function ca(e) {
  var t, r, n
  function i(o) {
    var s,
      l,
      u,
      c = this
    if (!(c instanceof i)) return new i(o)
    if (((c.constructor = i), Zs(o))) {
      ;(c.s = o.s),
        N
          ? !o.d || o.e > i.maxE
            ? ((c.e = NaN), (c.d = null))
            : o.e < i.minE
            ? ((c.e = 0), (c.d = [0]))
            : ((c.e = o.e), (c.d = o.d.slice()))
          : ((c.e = o.e), (c.d = o.d ? o.d.slice() : o.d))
      return
    }
    if (((u = typeof o), u === 'number')) {
      if (o === 0) {
        ;(c.s = 1 / o < 0 ? -1 : 1), (c.e = 0), (c.d = [0])
        return
      }
      if ((o < 0 ? ((o = -o), (c.s = -1)) : (c.s = 1), o === ~~o && o < 1e7)) {
        for (s = 0, l = o; l >= 10; l /= 10) s++
        N
          ? s > i.maxE
            ? ((c.e = NaN), (c.d = null))
            : s < i.minE
            ? ((c.e = 0), (c.d = [0]))
            : ((c.e = s), (c.d = [o]))
          : ((c.e = s), (c.d = [o]))
        return
      } else if (o * 0 !== 0) {
        o || (c.s = NaN), (c.e = NaN), (c.d = null)
        return
      }
      return Zi(c, o.toString())
    } else if (u !== 'string') throw Error(Ye + o)
    return (
      (l = o.charCodeAt(0)) === 45
        ? ((o = o.slice(1)), (c.s = -1))
        : (l === 43 && (o = o.slice(1)), (c.s = 1)),
      ia.test(o) ? Zi(c, o) : qp(c, o)
    )
  }
  if (
    (a(i, 'Decimal'),
    (i.prototype = v),
    (i.ROUND_UP = 0),
    (i.ROUND_DOWN = 1),
    (i.ROUND_CEIL = 2),
    (i.ROUND_FLOOR = 3),
    (i.ROUND_HALF_UP = 4),
    (i.ROUND_HALF_DOWN = 5),
    (i.ROUND_HALF_EVEN = 6),
    (i.ROUND_HALF_CEIL = 7),
    (i.ROUND_HALF_FLOOR = 8),
    (i.EUCLID = 9),
    (i.config = i.set = tf),
    (i.clone = ca),
    (i.isDecimal = Zs),
    (i.abs = Up),
    (i.acos = Gp),
    (i.acosh = Qp),
    (i.add = Kp),
    (i.asin = Wp),
    (i.asinh = Jp),
    (i.atan = Hp),
    (i.atanh = Yp),
    (i.atan2 = zp),
    (i.cbrt = Xp),
    (i.ceil = Zp),
    (i.clamp = ef),
    (i.cos = rf),
    (i.cosh = nf),
    (i.div = of),
    (i.exp = sf),
    (i.floor = af),
    (i.hypot = lf),
    (i.ln = uf),
    (i.log = cf),
    (i.log10 = ff),
    (i.log2 = pf),
    (i.max = df),
    (i.min = mf),
    (i.mod = gf),
    (i.mul = hf),
    (i.pow = yf),
    (i.random = bf),
    (i.round = Ef),
    (i.sign = wf),
    (i.sin = xf),
    (i.sinh = vf),
    (i.sqrt = Tf),
    (i.sub = Af),
    (i.sum = Sf),
    (i.tan = Pf),
    (i.tanh = _f),
    (i.trunc = Cf),
    e === void 0 && (e = {}),
    e && e.defaults !== !0)
  )
    for (
      n = [
        'precision',
        'rounding',
        'toExpNeg',
        'toExpPos',
        'maxE',
        'minE',
        'modulo',
        'crypto',
      ],
        t = 0;
      t < n.length;

    )
      e.hasOwnProperty((r = n[t++])) || (e[r] = this[r])
  return i.config(e), i
}
a(ca, 'clone')
function of(e, t) {
  return new this(e).div(t)
}
a(of, 'div')
function sf(e) {
  return new this(e).exp()
}
a(sf, 'exp')
function af(e) {
  return _((e = new this(e)), e.e + 1, 3)
}
a(af, 'floor')
function lf() {
  var e,
    t,
    r = new this(0)
  for (N = !1, e = 0; e < arguments.length; )
    if (((t = new this(arguments[e++])), t.d)) r.d && (r = r.plus(t.times(t)))
    else {
      if (t.s) return (N = !0), new this(1 / 0)
      r = t
    }
  return (N = !0), r.sqrt()
}
a(lf, 'hypot')
function Zs(e) {
  return e instanceof gt || (e && e.toStringTag === na) || !1
}
a(Zs, 'isDecimalInstance')
function uf(e) {
  return new this(e).ln()
}
a(uf, 'ln')
function cf(e, t) {
  return new this(e).log(t)
}
a(cf, 'log')
function pf(e) {
  return new this(e).log(2)
}
a(pf, 'log2')
function ff(e) {
  return new this(e).log(10)
}
a(ff, 'log10')
function df() {
  return aa(this, arguments, 'lt')
}
a(df, 'max')
function mf() {
  return aa(this, arguments, 'gt')
}
a(mf, 'min')
function gf(e, t) {
  return new this(e).mod(t)
}
a(gf, 'mod')
function hf(e, t) {
  return new this(e).mul(t)
}
a(hf, 'mul')
function yf(e, t) {
  return new this(e).pow(t)
}
a(yf, 'pow')
function bf(e) {
  var t,
    r,
    n,
    i,
    o = 0,
    s = new this(1),
    l = []
  if (
    (e === void 0 ? (e = this.precision) : pe(e, 1, ze),
    (n = Math.ceil(e / M)),
    this.crypto)
  )
    if (crypto.getRandomValues)
      for (t = crypto.getRandomValues(new Uint32Array(n)); o < n; )
        (i = t[o]),
          i >= 429e7
            ? (t[o] = crypto.getRandomValues(new Uint32Array(1))[0])
            : (l[o++] = i % 1e7)
    else if (crypto.randomBytes) {
      for (t = crypto.randomBytes((n *= 4)); o < n; )
        (i =
          t[o] + (t[o + 1] << 8) + (t[o + 2] << 16) + ((t[o + 3] & 127) << 24)),
          i >= 214e7
            ? crypto.randomBytes(4).copy(t, o)
            : (l.push(i % 1e7), (o += 4))
      o = n / 4
    } else throw Error(ra)
  else for (; o < n; ) l[o++] = (Math.random() * 1e7) | 0
  for (
    n = l[--o],
      e %= M,
      n && e && ((i = Q(10, M - e)), (l[o] = ((n / i) | 0) * i));
    l[o] === 0;
    o--
  )
    l.pop()
  if (o < 0) (r = 0), (l = [0])
  else {
    for (r = -1; l[0] === 0; r -= M) l.shift()
    for (n = 1, i = l[0]; i >= 10; i /= 10) n++
    n < M && (r -= M - n)
  }
  return (s.e = r), (s.d = l), s
}
a(bf, 'random')
function Ef(e) {
  return _((e = new this(e)), e.e + 1, this.rounding)
}
a(Ef, 'round')
function wf(e) {
  return (e = new this(e)), e.d ? (e.d[0] ? e.s : 0 * e.s) : e.s || NaN
}
a(wf, 'sign')
function xf(e) {
  return new this(e).sin()
}
a(xf, 'sin')
function vf(e) {
  return new this(e).sinh()
}
a(vf, 'sinh')
function Tf(e) {
  return new this(e).sqrt()
}
a(Tf, 'sqrt')
function Af(e, t) {
  return new this(e).sub(t)
}
a(Af, 'sub')
function Sf() {
  var e = 0,
    t = arguments,
    r = new this(t[e])
  for (N = !1; r.s && ++e < t.length; ) r = r.plus(t[e])
  return (N = !0), _(r, this.precision, this.rounding)
}
a(Sf, 'sum')
function Pf(e) {
  return new this(e).tan()
}
a(Pf, 'tan')
function _f(e) {
  return new this(e).tanh()
}
a(_f, 'tanh')
function Cf(e) {
  return _((e = new this(e)), e.e + 1, 1)
}
a(Cf, 'trunc')
v[Symbol.for('nodejs.util.inspect.custom')] = v.toString
v[Symbol.toStringTag] = 'Decimal'
var gt = (v.constructor = ca(Yi))
Pn = new gt(Pn)
_n = new gt(_n)
var ye = gt
var ro = O(fr()),
  ma = O(Rn())
var be = class {
  constructor(t, r, n, i) {
    ;(this.modelName = t),
      (this.name = r),
      (this.typeName = n),
      (this.isList = i)
  }
  _toGraphQLInputType() {
    return `${
      this.isList ? `List${this.typeName}` : this.typeName
    }FieldRefInput<${this.modelName}>`
  }
}
a(be, 'FieldRefImpl')
function Fn(e) {
  return e instanceof be
}
a(Fn, 'isFieldRef')
var da = [
    'JsonNullValueInput',
    'NullableJsonNullValueInput',
    'JsonNullValueFilter',
  ],
  In = Symbol(),
  to = new WeakMap(),
  Y = class {
    constructor(t) {
      t === In
        ? to.set(this, `Prisma.${this._getName()}`)
        : to.set(
            this,
            `new Prisma.${this._getNamespace()}.${this._getName()}()`
          )
    }
    _getName() {
      return this.constructor.name
    }
    toString() {
      return to.get(this)
    }
  }
a(Y, 'ObjectEnumValue')
var Nt = class extends Y {
  _getNamespace() {
    return 'NullTypes'
  }
}
a(Nt, 'NullTypesEnumValue')
var dr = class extends Nt {}
a(dr, 'DbNull')
var mr = class extends Nt {}
a(mr, 'JsonNull')
var gr = class extends Nt {}
a(gr, 'AnyNull')
var Rt = {
  classes: { DbNull: dr, JsonNull: mr, AnyNull: gr },
  instances: { DbNull: new dr(In), JsonNull: new mr(In), AnyNull: new gr(In) },
}
function Xe(e) {
  return gt.isDecimal(e)
    ? !0
    : e !== null &&
        typeof e == 'object' &&
        typeof e.s == 'number' &&
        typeof e.e == 'number' &&
        typeof e.toFixed == 'function' &&
        Array.isArray(e.d)
}
a(Xe, 'isDecimalJsLike')
var ie = a((e, t) => {
    let r = {}
    for (let n of e) {
      let i = n[t]
      r[i] = n
    }
    return r
  }, 'keyBy'),
  Ft = {
    String: !0,
    Int: !0,
    Float: !0,
    Boolean: !0,
    Long: !0,
    DateTime: !0,
    ID: !0,
    UUID: !0,
    Json: !0,
    Bytes: !0,
    Decimal: !0,
    BigInt: !0,
  }
var Of = {
  string: 'String',
  boolean: 'Boolean',
  object: 'Json',
  symbol: 'Symbol',
}
function It(e) {
  return typeof e == 'string' ? e : e.name
}
a(It, 'stringifyGraphQLType')
function yr(e, t) {
  return t ? `List<${e}>` : e
}
a(yr, 'wrapWithList')
var Mf =
    /^(\d{4}-(0[1-9]|1[012])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9]|60))(\.\d{1,})?(([Z])|([+|-]([01][0-9]|2[0-3]):[0-5][0-9]))$/,
  Nf =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function Dt(e, t) {
  let r = t?.type
  if (e === null) return 'null'
  if (Object.prototype.toString.call(e) === '[object BigInt]') return 'BigInt'
  if (ye.isDecimal(e) || (r === 'Decimal' && Xe(e))) return 'Decimal'
  if (Buffer.isBuffer(e)) return 'Bytes'
  if (Rf(e, t)) return r.name
  if (e instanceof Y) return e._getName()
  if (e instanceof be) return e._toGraphQLInputType()
  if (Array.isArray(e)) {
    let i = e.reduce((o, s) => {
      let l = Dt(s, t)
      return o.includes(l) || o.push(l), o
    }, [])
    return (
      i.includes('Float') && i.includes('Int') && (i = ['Float']),
      `List<${i.join(' | ')}>`
    )
  }
  let n = typeof e
  if (n === 'number') return Math.trunc(e) === e ? 'Int' : 'Float'
  if (Object.prototype.toString.call(e) === '[object Date]') return 'DateTime'
  if (n === 'string') {
    if (Nf.test(e)) return 'UUID'
    if (new Date(e).toString() === 'Invalid Date') return 'String'
    if (Mf.test(e)) return 'DateTime'
  }
  return Of[n]
}
a(Dt, 'getGraphQLType')
function Rf(e, t) {
  let r = t?.type
  if (!If(r)) return !1
  if (t?.namespace === 'prisma' && da.includes(r.name)) {
    let n = e?.constructor?.name
    return typeof n == 'string' && Rt.instances[n] === e && r.values.includes(n)
  }
  return typeof e == 'string' && r.values.includes(e)
}
a(Rf, 'isValidEnumValue')
function Dn(e, t) {
  return t.reduce(
    (n, i) => {
      let o = (0, ma.default)(e, i)
      return o < n.distance ? { distance: o, str: i } : n
    },
    {
      distance: Math.min(
        Math.floor(e.length) * 1.1,
        ...t.map((n) => n.length * 3)
      ),
      str: null,
    }
  ).str
}
a(Dn, 'getSuggestion')
function kt(e, t = !1) {
  if (typeof e == 'string') return e
  if (e.values)
    return `enum ${e.name} {
${(0, ro.default)(e.values.join(', '), 2)}
}`
  {
    let r = (0, ro.default)(
      e.fields.map((n) => {
        let i = `${n.name}`,
          o = `${t ? Ze.default.green(i) : i}${
            n.isRequired ? '' : '?'
          }: ${Ze.default.white(
            n.inputTypes
              .map((s) => yr(Ff(s.type) ? s.type.name : It(s.type), s.isList))
              .join(' | ')
          )}`
        return n.isRequired ? o : Ze.default.dim(o)
      }).join(`
`),
      2
    )
    return `${Ze.default.dim('type')} ${Ze.default.bold.dim(
      e.name
    )} ${Ze.default.dim('{')}
${r}
${Ze.default.dim('}')}`
  }
}
a(kt, 'stringifyInputType')
function Ff(e) {
  return typeof e != 'string'
}
a(Ff, 'argIsInputType')
function hr(e) {
  return typeof e == 'string' ? (e === 'Null' ? 'null' : e) : e.name
}
a(hr, 'getInputTypeName')
function br(e) {
  return typeof e == 'string' ? e : e.name
}
a(br, 'getOutputTypeName')
function no(e, t, r = !1) {
  if (typeof e == 'string') return e === 'Null' ? 'null' : e
  if (e.values) return e.values.join(' | ')
  let n = e,
    i =
      t &&
      n.fields.every(
        (o) =>
          o.inputTypes[0].location === 'inputObjectTypes' ||
          o.inputTypes[1]?.location === 'inputObjectTypes'
      )
  return r
    ? hr(e)
    : n.fields.reduce((o, s) => {
        let l = ''
        return (
          !i && !s.isRequired
            ? (l = s.inputTypes.map((u) => hr(u.type)).join(' | '))
            : (l = s.inputTypes
                .map((u) => no(u.type, s.isRequired, !0))
                .join(' | ')),
          (o[s.name + (s.isRequired ? '' : '?')] = l),
          o
        )
      }, {})
}
a(no, 'inputTypeToJson')
function ga(e, t, r) {
  let n = {}
  for (let i of e) n[r(i)] = i
  for (let i of t) {
    let o = r(i)
    n[o] || (n[o] = i)
  }
  return Object.values(n)
}
a(ga, 'unionBy')
function $t(e) {
  return e.substring(0, 1).toLowerCase() + e.substring(1)
}
a($t, 'lowerCase')
function ha(e) {
  return e.endsWith('GroupByOutputType')
}
a(ha, 'isGroupByOutputName')
function If(e) {
  return (
    typeof e == 'object' &&
    e !== null &&
    typeof e.name == 'string' &&
    Array.isArray(e.values)
  )
}
a(If, 'isSchemaEnum')
var Er = class {
  constructor({ datamodel: t }) {
    ;(this.datamodel = t),
      (this.datamodelEnumMap = this.getDatamodelEnumMap()),
      (this.modelMap = this.getModelMap()),
      (this.typeMap = this.getTypeMap()),
      (this.typeAndModelMap = this.getTypeModelMap())
  }
  getDatamodelEnumMap() {
    return ie(this.datamodel.enums, 'name')
  }
  getModelMap() {
    return { ...ie(this.datamodel.models, 'name') }
  }
  getTypeMap() {
    return { ...ie(this.datamodel.types, 'name') }
  }
  getTypeModelMap() {
    return { ...this.getTypeMap(), ...this.getModelMap() }
  }
}
a(Er, 'DMMFDatamodelHelper')
var wr = class {
  constructor({ mappings: t }) {
    ;(this.mappings = t), (this.mappingsMap = this.getMappingsMap())
  }
  getMappingsMap() {
    return ie(this.mappings.modelOperations, 'model')
  }
  getOtherOperationNames() {
    return [
      Object.values(this.mappings.otherOperations.write),
      Object.values(this.mappings.otherOperations.read),
    ].flat()
  }
}
a(wr, 'DMMFMappingsHelper')
var xr = class {
  constructor({ schema: t }) {
    this.outputTypeToMergedOutputType = a(
      (t) => ({ ...t, fields: t.fields }),
      'outputTypeToMergedOutputType'
    )
    ;(this.schema = t),
      (this.enumMap = this.getEnumMap()),
      (this.queryType = this.getQueryType()),
      (this.mutationType = this.getMutationType()),
      (this.outputTypes = this.getOutputTypes()),
      (this.outputTypeMap = this.getMergedOutputTypeMap()),
      this.resolveOutputTypes(),
      (this.inputObjectTypes = this.schema.inputObjectTypes),
      (this.inputTypeMap = this.getInputTypeMap()),
      this.resolveInputTypes(),
      this.resolveFieldArgumentTypes(),
      (this.queryType = this.outputTypeMap.Query),
      (this.mutationType = this.outputTypeMap.Mutation),
      (this.rootFieldMap = this.getRootFieldMap())
  }
  get [Symbol.toStringTag]() {
    return 'DMMFClass'
  }
  resolveOutputTypes() {
    for (let t of this.outputTypes.model) {
      for (let r of t.fields)
        typeof r.outputType.type == 'string' &&
          !Ft[r.outputType.type] &&
          (r.outputType.type =
            this.outputTypeMap[r.outputType.type] ||
            this.outputTypeMap[r.outputType.type] ||
            this.enumMap[r.outputType.type] ||
            r.outputType.type)
      t.fieldMap = ie(t.fields, 'name')
    }
    for (let t of this.outputTypes.prisma) {
      for (let r of t.fields)
        typeof r.outputType.type == 'string' &&
          !Ft[r.outputType.type] &&
          (r.outputType.type =
            this.outputTypeMap[r.outputType.type] ||
            this.outputTypeMap[r.outputType.type] ||
            this.enumMap[r.outputType.type] ||
            r.outputType.type)
      t.fieldMap = ie(t.fields, 'name')
    }
  }
  resolveInputTypes() {
    let t = this.inputObjectTypes.prisma
    this.inputObjectTypes.model && t.push(...this.inputObjectTypes.model)
    for (let r of t) {
      for (let n of r.fields)
        for (let i of n.inputTypes) {
          let o = i.type
          typeof o == 'string' &&
            !Ft[o] &&
            (this.inputTypeMap[o] || this.enumMap[o]) &&
            (i.type = this.inputTypeMap[o] || this.enumMap[o] || o)
        }
      r.fieldMap = ie(r.fields, 'name')
    }
  }
  resolveFieldArgumentTypes() {
    for (let t of this.outputTypes.prisma)
      for (let r of t.fields)
        for (let n of r.args)
          for (let i of n.inputTypes) {
            let o = i.type
            typeof o == 'string' &&
              !Ft[o] &&
              (i.type = this.inputTypeMap[o] || this.enumMap[o] || o)
          }
    for (let t of this.outputTypes.model)
      for (let r of t.fields)
        for (let n of r.args)
          for (let i of n.inputTypes) {
            let o = i.type
            typeof o == 'string' &&
              !Ft[o] &&
              (i.type = this.inputTypeMap[o] || this.enumMap[o] || i.type)
          }
  }
  getQueryType() {
    return this.schema.outputObjectTypes.prisma.find((t) => t.name === 'Query')
  }
  getMutationType() {
    return this.schema.outputObjectTypes.prisma.find(
      (t) => t.name === 'Mutation'
    )
  }
  getOutputTypes() {
    return {
      model: this.schema.outputObjectTypes.model.map(
        this.outputTypeToMergedOutputType
      ),
      prisma: this.schema.outputObjectTypes.prisma.map(
        this.outputTypeToMergedOutputType
      ),
    }
  }
  getEnumMap() {
    return {
      ...ie(this.schema.enumTypes.prisma, 'name'),
      ...(this.schema.enumTypes.model
        ? ie(this.schema.enumTypes.model, 'name')
        : void 0),
    }
  }
  hasEnumInNamespace(t, r) {
    return this.schema.enumTypes[r]?.find((n) => n.name === t) !== void 0
  }
  getMergedOutputTypeMap() {
    return {
      ...ie(this.outputTypes.model, 'name'),
      ...ie(this.outputTypes.prisma, 'name'),
    }
  }
  getInputTypeMap() {
    return {
      ...(this.schema.inputObjectTypes.model
        ? ie(this.schema.inputObjectTypes.model, 'name')
        : void 0),
      ...ie(this.schema.inputObjectTypes.prisma, 'name'),
    }
  }
  getRootFieldMap() {
    return {
      ...ie(this.queryType.fields, 'name'),
      ...ie(this.mutationType.fields, 'name'),
    }
  }
}
a(xr, 'DMMFSchemaHelper')
var et = class {
  constructor(t) {
    return Object.assign(this, new Er(t), new wr(t))
  }
}
a(et, 'BaseDMMFHelper')
Li(et, [Er, wr])
var qe = class {
  constructor(t) {
    return Object.assign(this, new et(t), new xr(t))
  }
}
a(qe, 'DMMFHelper')
Li(qe, [et, xr])
var Ie
;((t) => {
  let e
  ;((E) => (
    (E.findUnique = 'findUnique'),
    (E.findUniqueOrThrow = 'findUniqueOrThrow'),
    (E.findFirst = 'findFirst'),
    (E.findFirstOrThrow = 'findFirstOrThrow'),
    (E.findMany = 'findMany'),
    (E.create = 'create'),
    (E.createMany = 'createMany'),
    (E.update = 'update'),
    (E.updateMany = 'updateMany'),
    (E.upsert = 'upsert'),
    (E.delete = 'delete'),
    (E.deleteMany = 'deleteMany'),
    (E.groupBy = 'groupBy'),
    (E.count = 'count'),
    (E.aggregate = 'aggregate'),
    (E.findRaw = 'findRaw'),
    (E.aggregateRaw = 'aggregateRaw')
  ))((e = t.ModelAction || (t.ModelAction = {})))
})(Ie || (Ie = {}))
var Bn = O(Ta())
var td = 100,
  vr = []
typeof process < 'u' &&
  typeof process.stderr?.write != 'function' &&
  (Bn.default.log = console.debug ?? console.log)
function rd(e) {
  let t = (0, Bn.default)(e),
    r = Object.assign(
      (...n) => (
        (t.log = r.log),
        n.length !== 0 && vr.push([e, ...n]),
        vr.length > td && vr.shift(),
        t('', ...n)
      ),
      t
    )
  return r
}
a(rd, 'debugCall')
var so = Object.assign(rd, Bn.default)
function Aa(e = 7500) {
  let t = vr.map((r) =>
    r.map((n) => (typeof n == 'string' ? n : JSON.stringify(n))).join(' ')
  ).join(`
`)
  return t.length < e ? t : t.slice(-e)
}
a(Aa, 'getLogs')
function Sa() {
  vr.length = 0
}
a(Sa, 'clearLogs')
var U = so
var Pa = typeof globalThis == 'object' ? globalThis : global
var tt = '1.4.0'
var _a = /^(\d+)\.(\d+)\.(\d+)(-(.+))?$/
function nd(e) {
  var t = new Set([e]),
    r = new Set(),
    n = e.match(_a)
  if (!n)
    return function () {
      return !1
    }
  var i = { major: +n[1], minor: +n[2], patch: +n[3], prerelease: n[4] }
  if (i.prerelease != null)
    return a(function (u) {
      return u === e
    }, 'isExactmatch')
  function o(l) {
    return r.add(l), !1
  }
  a(o, '_reject')
  function s(l) {
    return t.add(l), !0
  }
  return (
    a(s, '_accept'),
    a(function (u) {
      if (t.has(u)) return !0
      if (r.has(u)) return !1
      var c = u.match(_a)
      if (!c) return o(u)
      var p = { major: +c[1], minor: +c[2], patch: +c[3], prerelease: c[4] }
      return p.prerelease != null || i.major !== p.major
        ? o(u)
        : i.major === 0
        ? i.minor === p.minor && i.patch <= p.patch
          ? s(u)
          : o(u)
        : i.minor <= p.minor
        ? s(u)
        : o(u)
    }, 'isCompatible')
  )
}
a(nd, '_makeCompatibilityCheck')
var Ca = nd(tt)
var od = tt.split('.')[0],
  Tr = Symbol.for('opentelemetry.js.api.' + od),
  Ar = Pa
function qn(e, t, r, n) {
  var i
  n === void 0 && (n = !1)
  var o = (Ar[Tr] = (i = Ar[Tr]) !== null && i !== void 0 ? i : { version: tt })
  if (!n && o[e]) {
    var s = new Error(
      '@opentelemetry/api: Attempted duplicate registration of API: ' + e
    )
    return r.error(s.stack || s.message), !1
  }
  if (o.version !== tt) {
    var s = new Error(
      '@opentelemetry/api: All API registration versions must match'
    )
    return r.error(s.stack || s.message), !1
  }
  return (
    (o[e] = t),
    r.debug(
      '@opentelemetry/api: Registered a global for ' + e + ' v' + tt + '.'
    ),
    !0
  )
}
a(qn, 'registerGlobal')
function yt(e) {
  var t,
    r,
    n = (t = Ar[Tr]) === null || t === void 0 ? void 0 : t.version
  if (!(!n || !Ca(n)))
    return (r = Ar[Tr]) === null || r === void 0 ? void 0 : r[e]
}
a(yt, 'getGlobal')
function Vn(e, t) {
  t.debug(
    '@opentelemetry/api: Unregistering a global for ' + e + ' v' + tt + '.'
  )
  var r = Ar[Tr]
  r && delete r[e]
}
a(Vn, 'unregisterGlobal')
var sd = function (e, t) {
    var r = typeof Symbol == 'function' && e[Symbol.iterator]
    if (!r) return e
    var n = r.call(e),
      i,
      o = [],
      s
    try {
      for (; (t === void 0 || t-- > 0) && !(i = n.next()).done; )
        o.push(i.value)
    } catch (l) {
      s = { error: l }
    } finally {
      try {
        i && !i.done && (r = n.return) && r.call(n)
      } finally {
        if (s) throw s.error
      }
    }
    return o
  },
  ad = function (e, t, r) {
    if (r || arguments.length === 2)
      for (var n = 0, i = t.length, o; n < i; n++)
        (o || !(n in t)) &&
          (o || (o = Array.prototype.slice.call(t, 0, n)), (o[n] = t[n]))
    return e.concat(o || Array.prototype.slice.call(t))
  },
  Oa = (function () {
    function e(t) {
      this._namespace = t.namespace || 'DiagComponentLogger'
    }
    return (
      a(e, 'DiagComponentLogger'),
      (e.prototype.debug = function () {
        for (var t = [], r = 0; r < arguments.length; r++) t[r] = arguments[r]
        return Sr('debug', this._namespace, t)
      }),
      (e.prototype.error = function () {
        for (var t = [], r = 0; r < arguments.length; r++) t[r] = arguments[r]
        return Sr('error', this._namespace, t)
      }),
      (e.prototype.info = function () {
        for (var t = [], r = 0; r < arguments.length; r++) t[r] = arguments[r]
        return Sr('info', this._namespace, t)
      }),
      (e.prototype.warn = function () {
        for (var t = [], r = 0; r < arguments.length; r++) t[r] = arguments[r]
        return Sr('warn', this._namespace, t)
      }),
      (e.prototype.verbose = function () {
        for (var t = [], r = 0; r < arguments.length; r++) t[r] = arguments[r]
        return Sr('verbose', this._namespace, t)
      }),
      e
    )
  })()
function Sr(e, t, r) {
  var n = yt('diag')
  if (!!n) return r.unshift(t), n[e].apply(n, ad([], sd(r), !1))
}
a(Sr, 'logProxy')
var le
;(function (e) {
  ;(e[(e.NONE = 0)] = 'NONE'),
    (e[(e.ERROR = 30)] = 'ERROR'),
    (e[(e.WARN = 50)] = 'WARN'),
    (e[(e.INFO = 60)] = 'INFO'),
    (e[(e.DEBUG = 70)] = 'DEBUG'),
    (e[(e.VERBOSE = 80)] = 'VERBOSE'),
    (e[(e.ALL = 9999)] = 'ALL')
})(le || (le = {}))
function Ma(e, t) {
  e < le.NONE ? (e = le.NONE) : e > le.ALL && (e = le.ALL), (t = t || {})
  function r(n, i) {
    var o = t[n]
    return typeof o == 'function' && e >= i ? o.bind(t) : function () {}
  }
  return (
    a(r, '_filterFunc'),
    {
      error: r('error', le.ERROR),
      warn: r('warn', le.WARN),
      info: r('info', le.INFO),
      debug: r('debug', le.DEBUG),
      verbose: r('verbose', le.VERBOSE),
    }
  )
}
a(Ma, 'createLogLevelDiagLogger')
var ld = function (e, t) {
    var r = typeof Symbol == 'function' && e[Symbol.iterator]
    if (!r) return e
    var n = r.call(e),
      i,
      o = [],
      s
    try {
      for (; (t === void 0 || t-- > 0) && !(i = n.next()).done; )
        o.push(i.value)
    } catch (l) {
      s = { error: l }
    } finally {
      try {
        i && !i.done && (r = n.return) && r.call(n)
      } finally {
        if (s) throw s.error
      }
    }
    return o
  },
  ud = function (e, t, r) {
    if (r || arguments.length === 2)
      for (var n = 0, i = t.length, o; n < i; n++)
        (o || !(n in t)) &&
          (o || (o = Array.prototype.slice.call(t, 0, n)), (o[n] = t[n]))
    return e.concat(o || Array.prototype.slice.call(t))
  },
  cd = 'diag',
  ao = (function () {
    function e() {
      function t(i) {
        return function () {
          for (var o = [], s = 0; s < arguments.length; s++) o[s] = arguments[s]
          var l = yt('diag')
          if (!!l) return l[i].apply(l, ud([], ld(o), !1))
        }
      }
      a(t, '_logProxy')
      var r = this,
        n = a(function (i, o) {
          var s, l, u
          if ((o === void 0 && (o = { logLevel: le.INFO }), i === r)) {
            var c = new Error(
              'Cannot use diag as the logger for itself. Please use a DiagLogger implementation like ConsoleDiagLogger or a custom implementation'
            )
            return (
              r.error((s = c.stack) !== null && s !== void 0 ? s : c.message),
              !1
            )
          }
          typeof o == 'number' && (o = { logLevel: o })
          var p = yt('diag'),
            f = Ma((l = o.logLevel) !== null && l !== void 0 ? l : le.INFO, i)
          if (p && !o.suppressOverrideMessage) {
            var d =
              (u = new Error().stack) !== null && u !== void 0
                ? u
                : '<failed to generate stacktrace>'
            p.warn('Current logger will be overwritten from ' + d),
              f.warn(
                'Current logger will overwrite one already registered from ' + d
              )
          }
          return qn('diag', f, r, !0)
        }, 'setLogger')
      ;(r.setLogger = n),
        (r.disable = function () {
          Vn(cd, r)
        }),
        (r.createComponentLogger = function (i) {
          return new Oa(i)
        }),
        (r.verbose = t('verbose')),
        (r.debug = t('debug')),
        (r.info = t('info')),
        (r.warn = t('warn')),
        (r.error = t('error'))
    }
    return (
      a(e, 'DiagAPI'),
      (e.instance = function () {
        return this._instance || (this._instance = new e()), this._instance
      }),
      e
    )
  })()
var pd = (function () {
    function e(t) {
      var r = this
      ;(r._currentContext = t ? new Map(t) : new Map()),
        (r.getValue = function (n) {
          return r._currentContext.get(n)
        }),
        (r.setValue = function (n, i) {
          var o = new e(r._currentContext)
          return o._currentContext.set(n, i), o
        }),
        (r.deleteValue = function (n) {
          var i = new e(r._currentContext)
          return i._currentContext.delete(n), i
        })
    }
    return a(e, 'BaseContext'), e
  })(),
  Na = new pd()
var fd = function (e, t) {
    var r = typeof Symbol == 'function' && e[Symbol.iterator]
    if (!r) return e
    var n = r.call(e),
      i,
      o = [],
      s
    try {
      for (; (t === void 0 || t-- > 0) && !(i = n.next()).done; )
        o.push(i.value)
    } catch (l) {
      s = { error: l }
    } finally {
      try {
        i && !i.done && (r = n.return) && r.call(n)
      } finally {
        if (s) throw s.error
      }
    }
    return o
  },
  dd = function (e, t, r) {
    if (r || arguments.length === 2)
      for (var n = 0, i = t.length, o; n < i; n++)
        (o || !(n in t)) &&
          (o || (o = Array.prototype.slice.call(t, 0, n)), (o[n] = t[n]))
    return e.concat(o || Array.prototype.slice.call(t))
  },
  Ra = (function () {
    function e() {}
    return (
      a(e, 'NoopContextManager'),
      (e.prototype.active = function () {
        return Na
      }),
      (e.prototype.with = function (t, r, n) {
        for (var i = [], o = 3; o < arguments.length; o++)
          i[o - 3] = arguments[o]
        return r.call.apply(r, dd([n], fd(i), !1))
      }),
      (e.prototype.bind = function (t, r) {
        return r
      }),
      (e.prototype.enable = function () {
        return this
      }),
      (e.prototype.disable = function () {
        return this
      }),
      e
    )
  })()
var md = function (e, t) {
    var r = typeof Symbol == 'function' && e[Symbol.iterator]
    if (!r) return e
    var n = r.call(e),
      i,
      o = [],
      s
    try {
      for (; (t === void 0 || t-- > 0) && !(i = n.next()).done; )
        o.push(i.value)
    } catch (l) {
      s = { error: l }
    } finally {
      try {
        i && !i.done && (r = n.return) && r.call(n)
      } finally {
        if (s) throw s.error
      }
    }
    return o
  },
  gd = function (e, t, r) {
    if (r || arguments.length === 2)
      for (var n = 0, i = t.length, o; n < i; n++)
        (o || !(n in t)) &&
          (o || (o = Array.prototype.slice.call(t, 0, n)), (o[n] = t[n]))
    return e.concat(o || Array.prototype.slice.call(t))
  },
  lo = 'context',
  hd = new Ra(),
  Fa = (function () {
    function e() {}
    return (
      a(e, 'ContextAPI'),
      (e.getInstance = function () {
        return this._instance || (this._instance = new e()), this._instance
      }),
      (e.prototype.setGlobalContextManager = function (t) {
        return qn(lo, t, ao.instance())
      }),
      (e.prototype.active = function () {
        return this._getContextManager().active()
      }),
      (e.prototype.with = function (t, r, n) {
        for (var i, o = [], s = 3; s < arguments.length; s++)
          o[s - 3] = arguments[s]
        return (i = this._getContextManager()).with.apply(
          i,
          gd([t, r, n], md(o), !1)
        )
      }),
      (e.prototype.bind = function (t, r) {
        return this._getContextManager().bind(t, r)
      }),
      (e.prototype._getContextManager = function () {
        return yt(lo) || hd
      }),
      (e.prototype.disable = function () {
        this._getContextManager().disable(), Vn(lo, ao.instance())
      }),
      e
    )
  })()
var Un = Fa.getInstance()
var kd = O(uo())
var Qn = 'libquery_engine'
function Pr(e, t) {
  let r = t === 'url'
  return e.includes('windows')
    ? r
      ? 'query_engine.dll.node'
      : `query_engine-${e}.dll.node`
    : e.includes('darwin')
    ? r
      ? `${Qn}.dylib.node`
      : `${Qn}-${e}.dylib.node`
    : r
    ? `${Qn}.so.node`
    : `${Qn}-${e}.so.node`
}
a(Pr, 'getNodeAPIName')
var Ja = O(require('child_process')),
  Ha = O(require('fs')),
  Ya = O(require('os'))
var Kn = Symbol('@ts-pattern/matcher'),
  Da = '@ts-pattern/anonymous-select-key',
  ka = a(function (e) {
    return Boolean(e && typeof e == 'object')
  }, 'e'),
  co = a(function (e) {
    return e && !!e[Kn]
  }, 'r'),
  bd = a(function e(t, r, n) {
    if (ka(t)) {
      if (co(t)) {
        var i = t[Kn]().match(r),
          o = i.matched,
          s = i.selections
        return (
          o &&
            s &&
            Object.keys(s).forEach(function (u) {
              return n(u, s[u])
            }),
          o
        )
      }
      if (!ka(r)) return !1
      if (Array.isArray(t))
        return (
          !!Array.isArray(r) &&
          t.length === r.length &&
          t.every(function (u, c) {
            return e(u, r[c], n)
          })
        )
      if (t instanceof Map)
        return (
          r instanceof Map &&
          Array.from(t.keys()).every(function (u) {
            return e(t.get(u), r.get(u), n)
          })
        )
      if (t instanceof Set) {
        if (!(r instanceof Set)) return !1
        if (t.size === 0) return r.size === 0
        if (t.size === 1) {
          var l = Array.from(t.values())[0]
          return co(l)
            ? Array.from(r.values()).every(function (u) {
                return e(l, u, n)
              })
            : r.has(l)
        }
        return Array.from(t.values()).every(function (u) {
          return r.has(u)
        })
      }
      return Object.keys(t).every(function (u) {
        var c,
          p = t[u]
        return (
          (u in r || (co((c = p)) && c[Kn]().matcherType === 'optional')) &&
          e(p, r[u], n)
        )
      })
    }
    return Object.is(r, t)
  }, 't')
function bt(e) {
  var t
  return (
    ((t = {})[Kn] = function () {
      return {
        match: function (r) {
          return { matched: Boolean(e(r)) }
        },
      }
    }),
    t
  )
}
a(bt, 'h')
var Z0 = bt(function (e) {
  return !0
})
var eb = bt(function (e) {
    return typeof e == 'string'
  }),
  tb = bt(function (e) {
    return typeof e == 'number'
  }),
  rb = bt(function (e) {
    return typeof e == 'boolean'
  }),
  nb = bt(function (e) {
    return typeof e == 'bigint'
  }),
  ib = bt(function (e) {
    return typeof e == 'symbol'
  }),
  ob = bt(function (e) {
    return e == null
  })
function qt(e) {
  return new Ed(e, [])
}
a(qt, 'K')
var Ed = (function () {
  function e(r, n) {
    ;(this.value = void 0),
      (this.cases = void 0),
      (this.value = r),
      (this.cases = n)
  }
  a(e, 'n')
  var t = e.prototype
  return (
    (t.with = function () {
      var r = [].slice.call(arguments),
        n = r[r.length - 1],
        i = [r[0]],
        o = []
      return (
        r.length === 3 && typeof r[1] == 'function'
          ? (i.push(r[0]), o.push(r[1]))
          : r.length > 2 && i.push.apply(i, r.slice(1, r.length - 1)),
        new e(
          this.value,
          this.cases.concat([
            {
              match: function (s) {
                var l = {},
                  u = Boolean(
                    i.some(function (c) {
                      return bd(c, s, function (p, f) {
                        l[p] = f
                      })
                    }) &&
                      o.every(function (c) {
                        return c(s)
                      })
                  )
                return {
                  matched: u,
                  value: u && Object.keys(l).length ? (Da in l ? l[Da] : l) : s,
                }
              },
              handler: n,
            },
          ])
        )
      )
    }),
    (t.when = function (r, n) {
      return new e(
        this.value,
        this.cases.concat([
          {
            match: function (i) {
              return { matched: Boolean(r(i)), value: i }
            },
            handler: n,
          },
        ])
      )
    }),
    (t.otherwise = function (r) {
      return new e(
        this.value,
        this.cases.concat([
          {
            match: function (n) {
              return { matched: !0, value: n }
            },
            handler: r,
          },
        ])
      ).run()
    }),
    (t.exhaustive = function () {
      return this.run()
    }),
    (t.run = function () {
      for (var r = this.value, n = void 0, i = 0; i < this.cases.length; i++) {
        var o = this.cases[i],
          s = o.match(this.value)
        if (s.matched) {
          ;(r = s.value), (n = o.handler)
          break
        }
      }
      if (!n) {
        var l
        try {
          l = JSON.stringify(this.value)
        } catch {
          l = this.value
        }
        throw new Error('Pattern matching error: no pattern matches value ' + l)
      }
      return n(r, this.value)
    }),
    e
  )
})()
var go = require('util')
var Ga = O(ae()),
  Qa = O(Ua())
function Or(e) {
  return (0, Qa.default)(e, e, { fallback: (t) => Ga.default.underline(t) })
}
a(Or, 'link')
var Ka = O(ae())
var vd = { warn: Ka.default.yellow('prisma:warn') },
  Td = { warn: () => !process.env.PRISMA_DISABLE_WARNINGS }
function Mr(e, ...t) {
  Td.warn() && console.warn(`${vd.warn} ${e}`, ...t)
}
a(Mr, 'warn')
var Ad = (0, go.promisify)(Ha.default.readFile),
  Sd = (0, go.promisify)(Ja.default.exec),
  we = U('prisma:get-platform'),
  Pd = ['1.0.x', '1.1.x', '3.0.x']
async function Hn() {
  let e = Ya.default.platform(),
    t = process.arch
  if (e === 'freebsd') {
    let s = await Nr(['freebsd-version'])
    if (s && s.trim().length > 0) {
      let u = /^(\d+)\.?/.exec(s)
      if (u)
        return { platform: 'freebsd', targetDistro: `freebsd${u[1]}`, arch: t }
    }
  }
  if (e !== 'linux') return { platform: e, arch: t }
  let r = await Cd(),
    n = await Dd(),
    i = Md({ arch: t, archFromUname: n, familyDistro: r.familyDistro }),
    { libssl: o } = await Nd(i)
  return { platform: 'linux', libssl: o, arch: t, archFromUname: n, ...r }
}
a(Hn, 'getos')
function _d(e) {
  let t = /^ID="?([^"\n]*)"?$/im,
    r = /^ID_LIKE="?([^"\n]*)"?$/im,
    n = t.exec(e),
    i = (n && n[1] && n[1].toLowerCase()) || '',
    o = r.exec(e),
    s = (o && o[1] && o[1].toLowerCase()) || '',
    l = qt({ id: i, idLike: s })
      .with({ id: 'alpine' }, ({ id: u }) => ({
        targetDistro: 'musl',
        familyDistro: u,
        originalDistro: u,
      }))
      .with({ id: 'raspbian' }, ({ id: u }) => ({
        targetDistro: 'arm',
        familyDistro: 'debian',
        originalDistro: u,
      }))
      .with({ id: 'nixos' }, ({ id: u }) => ({
        targetDistro: 'nixos',
        originalDistro: u,
        familyDistro: 'nixos',
      }))
      .with({ id: 'debian' }, { id: 'ubuntu' }, ({ id: u }) => ({
        targetDistro: 'debian',
        familyDistro: 'debian',
        originalDistro: u,
      }))
      .with(
        { id: 'rhel' },
        { id: 'centos' },
        { id: 'fedora' },
        ({ id: u }) => ({
          targetDistro: 'rhel',
          familyDistro: 'rhel',
          originalDistro: u,
        })
      )
      .when(
        ({ idLike: u }) => u.includes('debian') || u.includes('ubuntu'),
        ({ id: u }) => ({
          targetDistro: 'debian',
          familyDistro: 'debian',
          originalDistro: u,
        })
      )
      .when(
        ({ idLike: u }) => i === 'arch' || u.includes('arch'),
        ({ id: u }) => ({
          targetDistro: 'debian',
          familyDistro: 'arch',
          originalDistro: u,
        })
      )
      .when(
        ({ idLike: u }) =>
          u.includes('centos') ||
          u.includes('fedora') ||
          u.includes('rhel') ||
          u.includes('suse'),
        ({ id: u }) => ({
          targetDistro: 'rhel',
          familyDistro: 'rhel',
          originalDistro: u,
        })
      )
      .otherwise(({ id: u }) => ({
        targetDistro: void 0,
        familyDistro: void 0,
        originalDistro: u,
      }))
  return (
    we(`Found distro info:
${JSON.stringify(l, null, 2)}`),
    l
  )
}
a(_d, 'parseDistro')
async function Cd() {
  let e = '/etc/os-release'
  try {
    let t = await Ad(e, { encoding: 'utf-8' })
    return _d(t)
  } catch {
    return {
      targetDistro: void 0,
      familyDistro: void 0,
      originalDistro: void 0,
    }
  }
}
a(Cd, 'resolveDistro')
function Od(e) {
  let t = /^OpenSSL\s(\d+\.\d+)\.\d+/.exec(e)
  if (t) {
    let r = `${t[1]}.x`
    return za(r)
  }
}
a(Od, 'parseOpenSSLVersion')
function Wa(e) {
  let t = /libssl\.so\.(\d)(\.\d)?/.exec(e)
  if (t) {
    let r = `${t[1]}${t[2] ?? '.0'}.x`
    return za(r)
  }
}
a(Wa, 'parseLibSSLVersion')
function za(e) {
  let t = (() => {
    if (Za(e)) return e
    let r = e.split('.')
    return (r[1] = '0'), r.join('.')
  })()
  if (Pd.includes(t)) return t
}
a(za, 'sanitiseSSLVersion')
function Md(e) {
  return qt(e)
    .with(
      { familyDistro: 'musl' },
      () => (we('Trying platform-specific paths for "alpine"'), ['/lib'])
    )
    .with(
      { familyDistro: 'debian' },
      ({ archFromUname: t }) => (
        we('Trying platform-specific paths for "debian" (and "ubuntu")'),
        [`/usr/lib/${t}-linux-gnu`, `/lib/${t}-linux-gnu`]
      )
    )
    .with(
      { familyDistro: 'rhel' },
      () => (
        we('Trying platform-specific paths for "rhel"'),
        ['/lib64', '/usr/lib64']
      )
    )
    .otherwise(
      ({ familyDistro: t, arch: r, archFromUname: n }) => (
        we(`Don't know any platform-specific paths for "${t}" on ${r} (${n})`),
        []
      )
    )
}
a(Md, 'computeLibSSLSpecificPaths')
async function Nd(e) {
  let t = 'grep -v "libssl.so.0"',
    r = e.map((s) => `ls -v "libssl.so.0*" ${s} | grep libssl.so | ${t}`),
    n = await Nr(r)
  if (n) {
    we(`Found libssl.so file using platform-specific paths: ${n}`)
    let s = Wa(n)
    if ((we(`The parsed libssl version is: ${s}`), s))
      return { libssl: s, strategy: 'libssl-specific-path' }
  }
  we('Falling back to "ldconfig" and other generic paths')
  let i = await Nr([
    `ldconfig -p | sed "s/.*=>s*//" | sed "s|.*/||" | grep libssl | sort | ${t}`,
    `ls /lib64 | grep libssl | ${t}`,
    `ls /usr/lib64 | grep libssl | ${t}`,
    `ls /lib | grep libssl | ${t}`,
  ])
  if (i) {
    we(`Found libssl.so file using "ldconfig" or other generic paths: ${i}`)
    let s = Wa(i)
    if (s) return { libssl: s, strategy: 'ldconfig' }
  }
  let o = await Nr(['openssl version -v'])
  if (o) {
    we(`Found openssl binary with version: ${o}`)
    let s = Od(o)
    if ((we(`The parsed openssl version is: ${s}`), s))
      return { libssl: s, strategy: 'openssl-binary' }
  }
  return we("Couldn't find any version of libssl or OpenSSL in the system"), {}
}
a(Nd, 'getSSLVersion')
async function rt() {
  let { binaryTarget: e } = await Xa()
  return e
}
a(rt, 'getPlatform')
function Rd(e) {
  return e.binaryTarget !== void 0
}
a(Rd, 'isPlatformWithOSResultDefined')
async function ho() {
  let { memoized: e, ...t } = await Xa()
  return t
}
a(ho, 'getPlatformWithOSResult')
var Jn = {}
async function Xa() {
  if (Rd(Jn)) return Promise.resolve({ ...Jn, memoized: !0 })
  let e = await Hn(),
    t = Fd(e)
  return (Jn = { ...e, binaryTarget: t }), { ...Jn, memoized: !1 }
}
a(Xa, 'getPlatformMemoized')
function Fd(e) {
  let {
    platform: t,
    arch: r,
    archFromUname: n,
    libssl: i,
    targetDistro: o,
    familyDistro: s,
    originalDistro: l,
  } = e
  t === 'linux' &&
    !['x64', 'arm64'].includes(r) &&
    Mr(
      `Prisma only officially supports Linux on amd64 (x86_64) and arm64 (aarch64) system architectures. If you are using your own custom Prisma engines, you can ignore this warning, as long as you've compiled the engines for your system architecture "${n}".`
    )
  let u = '1.1.x'
  if (t === 'linux' && i === void 0) {
    let p = qt({ familyDistro: s })
      .with(
        { familyDistro: 'debian' },
        () =>
          "Please manually install OpenSSL via `apt-get update -y && apt-get install -y openssl` and try installing Prisma again. If you're running Prisma on Docker, you may also try to replace your base image with `node:lts-slim`, which already ships with OpenSSL installed."
      )
      .otherwise(
        () => 'Please manually install OpenSSL and try installing Prisma again.'
      )
    Mr(`Prisma failed to detect the libssl/openssl version to use, and may not work as expected. Defaulting to "openssl-${u}".
${p}`)
  }
  let c = 'debian'
  if (
    (t === 'linux' &&
      o === void 0 &&
      Mr(`Prisma doesn't know which engines to download for the Linux distro "${l}". Falling back to Prisma engines built "${c}".
Please report your experience by creating an issue at ${Or(
        'https://github.com/prisma/prisma/issues'
      )} so we can add your distro to the list of known supported distros.`),
    t === 'darwin' && r === 'arm64')
  )
    return 'darwin-arm64'
  if (t === 'darwin') return 'darwin'
  if (t === 'win32') return 'windows'
  if (t === 'freebsd') return o
  if (t === 'openbsd') return 'openbsd'
  if (t === 'netbsd') return 'netbsd'
  if (t === 'linux' && o === 'nixos') return 'linux-nixos'
  if (t === 'linux' && r === 'arm64')
    return `${o === 'musl' ? 'linux-musl-arm64' : 'linux-arm64'}-openssl-${
      i || u
    }`
  if (t === 'linux' && r === 'arm') return `linux-arm-openssl-${i || u}`
  if (t === 'linux' && o === 'musl') {
    let p = 'linux-musl'
    return !i || Za(i) ? p : `${p}-openssl-${i}`
  }
  return t === 'linux' && o && i
    ? `${o}-openssl-${i}`
    : (t !== 'linux' &&
        Mr(
          `Prisma detected unknown OS "${t}" and may not work as expected. Defaulting to "linux".`
        ),
      i ? `${c}-openssl-${i}` : o ? `${o}-openssl-${u}` : `${c}-openssl-${u}`)
}
a(Fd, 'getPlatformInternal')
async function Id(e) {
  try {
    return await e()
  } catch {
    return
  }
}
a(Id, 'discardError')
function Nr(e) {
  return Id(async () => {
    let t = await Promise.allSettled(e.map((o) => Sd(o))),
      r = t.findIndex(({ status: o }) => o === 'fulfilled')
    if (r === -1) return
    let { value: n } = t[r],
      i = String(n.stdout)
    return we(`Command "${e[r]}" successfully returned "${i}"`), i
  })
}
a(Nr, 'getFirstSuccessfulExec')
async function Dd() {
  return (await Nr(['uname -m']))?.trim()
}
a(Dd, 'getArchFromUname')
function Za(e) {
  return e.startsWith('1.')
}
a(Za, 'isLibssl1x')
var el = O(require('fs'))
async function yo() {
  let e = process.env.PRISMA_QUERY_ENGINE_LIBRARY,
    t = e && el.default.existsSync(e),
    r = await Hn()
  if (!t && (r.arch === 'x32' || r.arch === 'ia32'))
    throw new Error(
      'The default query engine type (Node-API, "library") is currently not supported for 32bit Node. Please set `engineType = "binary"` in the "generator" block of your "schema.prisma" file (or use the environment variables "PRISMA_CLIENT_ENGINE_TYPE=binary" and/or "PRISMA_CLI_QUERY_ENGINE_TYPE=binary".)'
    )
}
a(yo, 'isNodeAPISupported')
var bo = [
  'darwin',
  'darwin-arm64',
  'debian-openssl-1.0.x',
  'debian-openssl-1.1.x',
  'debian-openssl-3.0.x',
  'rhel-openssl-1.0.x',
  'rhel-openssl-1.1.x',
  'rhel-openssl-3.0.x',
  'linux-arm64-openssl-1.1.x',
  'linux-arm64-openssl-1.0.x',
  'linux-arm64-openssl-3.0.x',
  'linux-arm-openssl-1.1.x',
  'linux-arm-openssl-1.0.x',
  'linux-arm-openssl-3.0.x',
  'linux-musl',
  'linux-musl-openssl-3.0.x',
  'linux-musl-arm64-openssl-1.1.x',
  'linux-musl-arm64-openssl-3.0.x',
  'linux-nixos',
  'windows',
  'freebsd11',
  'freebsd12',
  'freebsd13',
  'openbsd',
  'netbsd',
  'arm',
]
var B = O(require('path')),
  $d = O(uo())
var Db = U('prisma:engines')
function tl() {
  return B.default.join(__dirname, '../')
}
a(tl, 'getEnginesPath')
var kb = 'libquery-engine'
B.default.join(__dirname, '../query-engine-darwin')
B.default.join(__dirname, '../query-engine-darwin-arm64')
B.default.join(__dirname, '../query-engine-debian-openssl-1.0.x')
B.default.join(__dirname, '../query-engine-debian-openssl-1.1.x')
B.default.join(__dirname, '../query-engine-debian-openssl-3.0.x')
B.default.join(__dirname, '../query-engine-rhel-openssl-1.0.x')
B.default.join(__dirname, '../query-engine-rhel-openssl-1.1.x')
B.default.join(__dirname, '../query-engine-rhel-openssl-3.0.x')
B.default.join(__dirname, '../libquery_engine-darwin.dylib.node')
B.default.join(__dirname, '../libquery_engine-darwin-arm64.dylib.node')
B.default.join(__dirname, '../libquery_engine-debian-openssl-1.0.x.so.node')
B.default.join(__dirname, '../libquery_engine-debian-openssl-1.1.x.so.node')
B.default.join(__dirname, '../libquery_engine-debian-openssl-3.0.x.so.node')
B.default.join(
  __dirname,
  '../libquery_engine-linux-arm64-openssl-1.0.x.so.node'
)
B.default.join(
  __dirname,
  '../libquery_engine-linux-arm64-openssl-1.1.x.so.node'
)
B.default.join(
  __dirname,
  '../libquery_engine-linux-arm64-openssl-3.0.x.so.node'
)
B.default.join(__dirname, '../libquery_engine-linux-musl.so.node')
B.default.join(__dirname, '../libquery_engine-linux-musl-openssl-3.0.x.so.node')
B.default.join(__dirname, '../libquery_engine-rhel-openssl-1.0.x.so.node')
B.default.join(__dirname, '../libquery_engine-rhel-openssl-1.1.x.so.node')
B.default.join(__dirname, '../libquery_engine-rhel-openssl-3.0.x.so.node')
B.default.join(__dirname, '../query_engine-windows.dll.node')
var nt = class {}
a(nt, 'Engine')
var G = class extends Error {
  constructor(r, n, i) {
    super(r)
    ;(this.clientVersion = n), (this.errorCode = i), Error.captureStackTrace(G)
  }
  get [Symbol.toStringTag]() {
    return 'PrismaClientInitializationError'
  }
}
a(G, 'PrismaClientInitializationError')
var X = class extends Error {
  constructor(r, { code: n, clientVersion: i, meta: o, batchRequestIdx: s }) {
    super(r)
    ;(this.code = n),
      (this.clientVersion = i),
      (this.meta = o),
      Object.defineProperty(this, 'batchRequestIdx', {
        value: s,
        enumerable: !1,
        writable: !0,
      })
  }
  get [Symbol.toStringTag]() {
    return 'PrismaClientKnownRequestError'
  }
}
a(X, 'PrismaClientKnownRequestError')
var fe = class extends Error {
  constructor(r, n) {
    super(r)
    this.clientVersion = n
  }
  get [Symbol.toStringTag]() {
    return 'PrismaClientRustPanicError'
  }
}
a(fe, 'PrismaClientRustPanicError')
var Z = class extends Error {
  constructor(r, { clientVersion: n, batchRequestIdx: i }) {
    super(r)
    ;(this.clientVersion = n),
      Object.defineProperty(this, 'batchRequestIdx', {
        value: i,
        writable: !0,
        enumerable: !1,
      })
  }
  get [Symbol.toStringTag]() {
    return 'PrismaClientUnknownRequestError'
  }
}
a(Z, 'PrismaClientUnknownRequestError')
var fl = O(ae()),
  Eo = O(Rr())
var al = O(ol())
var Zb = U('plusX')
function sl(e) {
  return { fromEnvVar: null, value: e }
}
a(sl, 'transformPlatformToEnvValue')
function ll(e, t) {
  return (
    (e = e || []),
    e.find((r) => r.value === 'native') ? [...e, sl(t)] : [sl('native'), ...e]
  )
}
a(ll, 'fixBinaryTargets')
function ul({
  title: e,
  user: t = 'prisma',
  repo: r = 'prisma',
  template: n = 'bug_report.md',
  body: i,
}) {
  return (0, al.default)({ user: t, repo: r, template: n, title: e, body: i })
}
a(ul, 'getGitHubIssueUrl')
function cl(e) {
  return e
    ? e
        .replace(/".*"/g, '"X"')
        .replace(/[\s:\[]([+-]?([0-9]*[.])?[0-9]+)/g, (t) => `${t[0]}5`)
    : ''
}
a(cl, 'maskQuery')
function pl(e) {
  return e
    .split(
      `
`
    )
    .map((t) =>
      t
        .replace(
          /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)\s*/,
          ''
        )
        .replace(/\+\d+\s*ms$/, '')
    ).join(`
`)
}
a(pl, 'normalizeLogs')
function dl({
  version: e,
  platform: t,
  title: r,
  description: n,
  engineVersion: i,
  database: o,
  query: s,
}) {
  let l = Aa(6e3 - (s?.length ?? 0)),
    u = pl((0, Eo.default)(l)),
    c = n
      ? `# Description
\`\`\`
${n}
\`\`\``
      : '',
    p = (0,
    Eo.default)(`Hi Prisma Team! My Prisma Client just crashed. This is the report:
## Versions

| Name            | Version            |
|-----------------|--------------------|
| Node            | ${process.version?.padEnd(19)}| 
| OS              | ${t?.padEnd(19)}|
| Prisma Client   | ${e?.padEnd(19)}|
| Query Engine    | ${i?.padEnd(19)}|
| Database        | ${o?.padEnd(19)}|

${c}

## Logs
\`\`\`
${u}
\`\`\`

## Client Snippet
\`\`\`ts
// PLEASE FILL YOUR CODE SNIPPET HERE
\`\`\`

## Schema
\`\`\`prisma
// PLEASE ADD YOUR SCHEMA HERE IF POSSIBLE
\`\`\`

## Prisma Engine Query
\`\`\`
${s ? cl(s) : ''}
\`\`\`
`),
    f = ul({ title: r, body: p })
  return `${r}

This is a non-recoverable error which probably happens when the Prisma Query Engine has a panic.

${fl.default.underline(f)}

If you want the Prisma team to look into it, please open the link above \u{1F64F}
To increase the chance of success, please post your schema and a snippet of
how you used Prisma Client in the issue. 
`
}
a(dl, 'getErrorMessageWithLink')
function ml({ error: e, user_facing_error: t }, r) {
  return t.error_code
    ? new X(t.message, {
        code: t.error_code,
        clientVersion: r,
        meta: t.meta,
        batchRequestIdx: t.batch_request_idx,
      })
    : new Z(e, { clientVersion: r, batchRequestIdx: t.batch_request_idx })
}
a(ml, 'prismaGraphQLToJSError')
function gl(e, t) {
  return jd(e)
    ? !t || t.kind === 'itx'
      ? { batch: e, transaction: !1 }
      : { batch: e, transaction: !0, isolationLevel: t.options.isolationLevel }
    : {
        batch: e,
        transaction:
          t?.kind === 'batch'
            ? { isolationLevel: t.options.isolationLevel }
            : void 0,
      }
}
a(gl, 'getBatchRequestPayload')
function jd(e) {
  return typeof e[0].query == 'string'
}
a(jd, 'isGraphQLBatch')
var hl = O(fr())
function yl(e) {
  return String(new zn(e))
}
a(yl, 'printGeneratorConfig')
var zn = class {
  constructor(t) {
    this.config = t
  }
  toString() {
    let { config: t } = this,
      r = t.provider.fromEnvVar
        ? `env("${t.provider.fromEnvVar}")`
        : t.provider.value,
      n = JSON.parse(
        JSON.stringify({ provider: r, binaryTargets: Bd(t.binaryTargets) })
      )
    return `generator ${t.name} {
${(0, hl.default)(qd(n), 2)}
}`
  }
}
a(zn, 'GeneratorConfigClass')
function Bd(e) {
  let t
  if (e.length > 0) {
    let r = e.find((n) => n.fromEnvVar !== null)
    r ? (t = `env("${r.fromEnvVar}")`) : (t = e.map((n) => n.value))
  } else t = void 0
  return t
}
a(Bd, 'getOriginalBinaryTargetsValue')
function qd(e) {
  let t = Object.keys(e).reduce((r, n) => Math.max(r, n.length), 0)
  return Object.entries(e).map(([r, n]) => `${r.padEnd(t)} = ${Vd(n)}`).join(`
`)
}
a(qd, 'printDatamodelObject')
function Vd(e) {
  return JSON.parse(
    JSON.stringify(e, (t, r) =>
      Array.isArray(r)
        ? `[${r.map((n) => JSON.stringify(n)).join(', ')}]`
        : JSON.stringify(r)
    )
  )
}
a(Vd, 'niceStringify')
var bl = typeof globalThis == 'object' ? globalThis : global
var it = '1.3.0'
var El = /^(\d+)\.(\d+)\.(\d+)(-(.+))?$/
function Ud(e) {
  var t = new Set([e]),
    r = new Set(),
    n = e.match(El)
  if (!n)
    return function () {
      return !1
    }
  var i = { major: +n[1], minor: +n[2], patch: +n[3], prerelease: n[4] }
  if (i.prerelease != null)
    return a(function (u) {
      return u === e
    }, 'isExactmatch')
  function o(l) {
    return r.add(l), !1
  }
  a(o, '_reject')
  function s(l) {
    return t.add(l), !0
  }
  return (
    a(s, '_accept'),
    a(function (u) {
      if (t.has(u)) return !0
      if (r.has(u)) return !1
      var c = u.match(El)
      if (!c) return o(u)
      var p = { major: +c[1], minor: +c[2], patch: +c[3], prerelease: c[4] }
      return p.prerelease != null || i.major !== p.major
        ? o(u)
        : i.major === 0
        ? i.minor === p.minor && i.patch <= p.patch
          ? s(u)
          : o(u)
        : i.minor <= p.minor
        ? s(u)
        : o(u)
    }, 'isCompatible')
  )
}
a(Ud, '_makeCompatibilityCheck')
var wl = Ud(it)
var Gd = it.split('.')[0],
  Fr = Symbol.for('opentelemetry.js.api.' + Gd),
  Ir = bl
function Gt(e, t, r, n) {
  var i
  n === void 0 && (n = !1)
  var o = (Ir[Fr] = (i = Ir[Fr]) !== null && i !== void 0 ? i : { version: it })
  if (!n && o[e]) {
    var s = new Error(
      '@opentelemetry/api: Attempted duplicate registration of API: ' + e
    )
    return r.error(s.stack || s.message), !1
  }
  if (o.version !== it) {
    var s = new Error(
      '@opentelemetry/api: All API registration versions must match'
    )
    return r.error(s.stack || s.message), !1
  }
  return (
    (o[e] = t),
    r.debug(
      '@opentelemetry/api: Registered a global for ' + e + ' v' + it + '.'
    ),
    !0
  )
}
a(Gt, 'registerGlobal')
function Ve(e) {
  var t,
    r,
    n = (t = Ir[Fr]) === null || t === void 0 ? void 0 : t.version
  if (!(!n || !wl(n)))
    return (r = Ir[Fr]) === null || r === void 0 ? void 0 : r[e]
}
a(Ve, 'getGlobal')
function Qt(e, t) {
  t.debug(
    '@opentelemetry/api: Unregistering a global for ' + e + ' v' + it + '.'
  )
  var r = Ir[Fr]
  r && delete r[e]
}
a(Qt, 'unregisterGlobal')
var Qd = function (e, t) {
    var r = typeof Symbol == 'function' && e[Symbol.iterator]
    if (!r) return e
    var n = r.call(e),
      i,
      o = [],
      s
    try {
      for (; (t === void 0 || t-- > 0) && !(i = n.next()).done; )
        o.push(i.value)
    } catch (l) {
      s = { error: l }
    } finally {
      try {
        i && !i.done && (r = n.return) && r.call(n)
      } finally {
        if (s) throw s.error
      }
    }
    return o
  },
  Kd = function (e, t, r) {
    if (r || arguments.length === 2)
      for (var n = 0, i = t.length, o; n < i; n++)
        (o || !(n in t)) &&
          (o || (o = Array.prototype.slice.call(t, 0, n)), (o[n] = t[n]))
    return e.concat(o || Array.prototype.slice.call(t))
  },
  xl = (function () {
    function e(t) {
      this._namespace = t.namespace || 'DiagComponentLogger'
    }
    return (
      a(e, 'DiagComponentLogger'),
      (e.prototype.debug = function () {
        for (var t = [], r = 0; r < arguments.length; r++) t[r] = arguments[r]
        return Dr('debug', this._namespace, t)
      }),
      (e.prototype.error = function () {
        for (var t = [], r = 0; r < arguments.length; r++) t[r] = arguments[r]
        return Dr('error', this._namespace, t)
      }),
      (e.prototype.info = function () {
        for (var t = [], r = 0; r < arguments.length; r++) t[r] = arguments[r]
        return Dr('info', this._namespace, t)
      }),
      (e.prototype.warn = function () {
        for (var t = [], r = 0; r < arguments.length; r++) t[r] = arguments[r]
        return Dr('warn', this._namespace, t)
      }),
      (e.prototype.verbose = function () {
        for (var t = [], r = 0; r < arguments.length; r++) t[r] = arguments[r]
        return Dr('verbose', this._namespace, t)
      }),
      e
    )
  })()
function Dr(e, t, r) {
  var n = Ve('diag')
  if (!!n) return r.unshift(t), n[e].apply(n, Kd([], Qd(r), !1))
}
a(Dr, 'logProxy')
var ue
;(function (e) {
  ;(e[(e.NONE = 0)] = 'NONE'),
    (e[(e.ERROR = 30)] = 'ERROR'),
    (e[(e.WARN = 50)] = 'WARN'),
    (e[(e.INFO = 60)] = 'INFO'),
    (e[(e.DEBUG = 70)] = 'DEBUG'),
    (e[(e.VERBOSE = 80)] = 'VERBOSE'),
    (e[(e.ALL = 9999)] = 'ALL')
})(ue || (ue = {}))
function vl(e, t) {
  e < ue.NONE ? (e = ue.NONE) : e > ue.ALL && (e = ue.ALL), (t = t || {})
  function r(n, i) {
    var o = t[n]
    return typeof o == 'function' && e >= i ? o.bind(t) : function () {}
  }
  return (
    a(r, '_filterFunc'),
    {
      error: r('error', ue.ERROR),
      warn: r('warn', ue.WARN),
      info: r('info', ue.INFO),
      debug: r('debug', ue.DEBUG),
      verbose: r('verbose', ue.VERBOSE),
    }
  )
}
a(vl, 'createLogLevelDiagLogger')
var Wd = function (e, t) {
    var r = typeof Symbol == 'function' && e[Symbol.iterator]
    if (!r) return e
    var n = r.call(e),
      i,
      o = [],
      s
    try {
      for (; (t === void 0 || t-- > 0) && !(i = n.next()).done; )
        o.push(i.value)
    } catch (l) {
      s = { error: l }
    } finally {
      try {
        i && !i.done && (r = n.return) && r.call(n)
      } finally {
        if (s) throw s.error
      }
    }
    return o
  },
  Jd = function (e, t, r) {
    if (r || arguments.length === 2)
      for (var n = 0, i = t.length, o; n < i; n++)
        (o || !(n in t)) &&
          (o || (o = Array.prototype.slice.call(t, 0, n)), (o[n] = t[n]))
    return e.concat(o || Array.prototype.slice.call(t))
  },
  Hd = 'diag',
  ot = (function () {
    function e() {
      function t(i) {
        return function () {
          for (var o = [], s = 0; s < arguments.length; s++) o[s] = arguments[s]
          var l = Ve('diag')
          if (!!l) return l[i].apply(l, Jd([], Wd(o), !1))
        }
      }
      a(t, '_logProxy')
      var r = this,
        n = a(function (i, o) {
          var s, l, u
          if ((o === void 0 && (o = { logLevel: ue.INFO }), i === r)) {
            var c = new Error(
              'Cannot use diag as the logger for itself. Please use a DiagLogger implementation like ConsoleDiagLogger or a custom implementation'
            )
            return (
              r.error((s = c.stack) !== null && s !== void 0 ? s : c.message),
              !1
            )
          }
          typeof o == 'number' && (o = { logLevel: o })
          var p = Ve('diag'),
            f = vl((l = o.logLevel) !== null && l !== void 0 ? l : ue.INFO, i)
          if (p && !o.suppressOverrideMessage) {
            var d =
              (u = new Error().stack) !== null && u !== void 0
                ? u
                : '<failed to generate stacktrace>'
            p.warn('Current logger will be overwritten from ' + d),
              f.warn(
                'Current logger will overwrite one already registered from ' + d
              )
          }
          return Gt('diag', f, r, !0)
        }, 'setLogger')
      ;(r.setLogger = n),
        (r.disable = function () {
          Qt(Hd, r)
        }),
        (r.createComponentLogger = function (i) {
          return new xl(i)
        }),
        (r.verbose = t('verbose')),
        (r.debug = t('debug')),
        (r.info = t('info')),
        (r.warn = t('warn')),
        (r.error = t('error'))
    }
    return (
      a(e, 'DiagAPI'),
      (e.instance = function () {
        return this._instance || (this._instance = new e()), this._instance
      }),
      e
    )
  })()
function wo(e) {
  return Symbol.for(e)
}
a(wo, 'createContextKey')
var Yd = (function () {
    function e(t) {
      var r = this
      ;(r._currentContext = t ? new Map(t) : new Map()),
        (r.getValue = function (n) {
          return r._currentContext.get(n)
        }),
        (r.setValue = function (n, i) {
          var o = new e(r._currentContext)
          return o._currentContext.set(n, i), o
        }),
        (r.deleteValue = function (n) {
          var i = new e(r._currentContext)
          return i._currentContext.delete(n), i
        })
    }
    return a(e, 'BaseContext'), e
  })(),
  kr = new Yd()
var zd = function (e, t) {
    var r = typeof Symbol == 'function' && e[Symbol.iterator]
    if (!r) return e
    var n = r.call(e),
      i,
      o = [],
      s
    try {
      for (; (t === void 0 || t-- > 0) && !(i = n.next()).done; )
        o.push(i.value)
    } catch (l) {
      s = { error: l }
    } finally {
      try {
        i && !i.done && (r = n.return) && r.call(n)
      } finally {
        if (s) throw s.error
      }
    }
    return o
  },
  Xd = function (e, t, r) {
    if (r || arguments.length === 2)
      for (var n = 0, i = t.length, o; n < i; n++)
        (o || !(n in t)) &&
          (o || (o = Array.prototype.slice.call(t, 0, n)), (o[n] = t[n]))
    return e.concat(o || Array.prototype.slice.call(t))
  },
  Tl = (function () {
    function e() {}
    return (
      a(e, 'NoopContextManager'),
      (e.prototype.active = function () {
        return kr
      }),
      (e.prototype.with = function (t, r, n) {
        for (var i = [], o = 3; o < arguments.length; o++)
          i[o - 3] = arguments[o]
        return r.call.apply(r, Xd([n], zd(i), !1))
      }),
      (e.prototype.bind = function (t, r) {
        return r
      }),
      (e.prototype.enable = function () {
        return this
      }),
      (e.prototype.disable = function () {
        return this
      }),
      e
    )
  })()
var Zd = function (e, t) {
    var r = typeof Symbol == 'function' && e[Symbol.iterator]
    if (!r) return e
    var n = r.call(e),
      i,
      o = [],
      s
    try {
      for (; (t === void 0 || t-- > 0) && !(i = n.next()).done; )
        o.push(i.value)
    } catch (l) {
      s = { error: l }
    } finally {
      try {
        i && !i.done && (r = n.return) && r.call(n)
      } finally {
        if (s) throw s.error
      }
    }
    return o
  },
  em = function (e, t, r) {
    if (r || arguments.length === 2)
      for (var n = 0, i = t.length, o; n < i; n++)
        (o || !(n in t)) &&
          (o || (o = Array.prototype.slice.call(t, 0, n)), (o[n] = t[n]))
    return e.concat(o || Array.prototype.slice.call(t))
  },
  xo = 'context',
  tm = new Tl(),
  Kt = (function () {
    function e() {}
    return (
      a(e, 'ContextAPI'),
      (e.getInstance = function () {
        return this._instance || (this._instance = new e()), this._instance
      }),
      (e.prototype.setGlobalContextManager = function (t) {
        return Gt(xo, t, ot.instance())
      }),
      (e.prototype.active = function () {
        return this._getContextManager().active()
      }),
      (e.prototype.with = function (t, r, n) {
        for (var i, o = [], s = 3; s < arguments.length; s++)
          o[s - 3] = arguments[s]
        return (i = this._getContextManager()).with.apply(
          i,
          em([t, r, n], Zd(o), !1)
        )
      }),
      (e.prototype.bind = function (t, r) {
        return this._getContextManager().bind(t, r)
      }),
      (e.prototype._getContextManager = function () {
        return Ve(xo) || tm
      }),
      (e.prototype.disable = function () {
        this._getContextManager().disable(), Qt(xo, ot.instance())
      }),
      e
    )
  })()
var st
;(function (e) {
  ;(e[(e.NONE = 0)] = 'NONE'), (e[(e.SAMPLED = 1)] = 'SAMPLED')
})(st || (st = {}))
var vo = '0000000000000000',
  To = '00000000000000000000000000000000',
  Al = { traceId: To, spanId: vo, traceFlags: st.NONE }
var at = (function () {
  function e(t) {
    t === void 0 && (t = Al), (this._spanContext = t)
  }
  return (
    a(e, 'NonRecordingSpan'),
    (e.prototype.spanContext = function () {
      return this._spanContext
    }),
    (e.prototype.setAttribute = function (t, r) {
      return this
    }),
    (e.prototype.setAttributes = function (t) {
      return this
    }),
    (e.prototype.addEvent = function (t, r) {
      return this
    }),
    (e.prototype.setStatus = function (t) {
      return this
    }),
    (e.prototype.updateName = function (t) {
      return this
    }),
    (e.prototype.end = function (t) {}),
    (e.prototype.isRecording = function () {
      return !1
    }),
    (e.prototype.recordException = function (t, r) {}),
    e
  )
})()
var Ao = wo('OpenTelemetry Context Key SPAN')
function Xn(e) {
  return e.getValue(Ao) || void 0
}
a(Xn, 'getSpan')
function Sl() {
  return Xn(Kt.getInstance().active())
}
a(Sl, 'getActiveSpan')
function $r(e, t) {
  return e.setValue(Ao, t)
}
a($r, 'setSpan')
function Pl(e) {
  return e.deleteValue(Ao)
}
a(Pl, 'deleteSpan')
function _l(e, t) {
  return $r(e, new at(t))
}
a(_l, 'setSpanContext')
function Zn(e) {
  var t
  return (t = Xn(e)) === null || t === void 0 ? void 0 : t.spanContext()
}
a(Zn, 'getSpanContext')
var rm = /^([0-9a-f]{32})$/i,
  nm = /^[0-9a-f]{16}$/i
function im(e) {
  return rm.test(e) && e !== To
}
a(im, 'isValidTraceId')
function om(e) {
  return nm.test(e) && e !== vo
}
a(om, 'isValidSpanId')
function ei(e) {
  return im(e.traceId) && om(e.spanId)
}
a(ei, 'isSpanContextValid')
function Cl(e) {
  return new at(e)
}
a(Cl, 'wrapSpanContext')
var Ol = Kt.getInstance(),
  ti = (function () {
    function e() {}
    return (
      a(e, 'NoopTracer'),
      (e.prototype.startSpan = function (t, r, n) {
        var i = Boolean(r?.root)
        if (i) return new at()
        var o = n && Zn(n)
        return sm(o) && ei(o) ? new at(o) : new at()
      }),
      (e.prototype.startActiveSpan = function (t, r, n, i) {
        var o, s, l
        if (!(arguments.length < 2)) {
          arguments.length === 2
            ? (l = r)
            : arguments.length === 3
            ? ((o = r), (l = n))
            : ((o = r), (s = n), (l = i))
          var u = s ?? Ol.active(),
            c = this.startSpan(t, o, u),
            p = $r(u, c)
          return Ol.with(p, l, void 0, c)
        }
      }),
      e
    )
  })()
function sm(e) {
  return (
    typeof e == 'object' &&
    typeof e.spanId == 'string' &&
    typeof e.traceId == 'string' &&
    typeof e.traceFlags == 'number'
  )
}
a(sm, 'isSpanContext')
var am = new ti(),
  Ml = (function () {
    function e(t, r, n, i) {
      ;(this._provider = t),
        (this.name = r),
        (this.version = n),
        (this.options = i)
    }
    return (
      a(e, 'ProxyTracer'),
      (e.prototype.startSpan = function (t, r, n) {
        return this._getTracer().startSpan(t, r, n)
      }),
      (e.prototype.startActiveSpan = function (t, r, n, i) {
        var o = this._getTracer()
        return Reflect.apply(o.startActiveSpan, o, arguments)
      }),
      (e.prototype._getTracer = function () {
        if (this._delegate) return this._delegate
        var t = this._provider.getDelegateTracer(
          this.name,
          this.version,
          this.options
        )
        return t ? ((this._delegate = t), this._delegate) : am
      }),
      e
    )
  })()
var Nl = (function () {
  function e() {}
  return (
    a(e, 'NoopTracerProvider'),
    (e.prototype.getTracer = function (t, r, n) {
      return new ti()
    }),
    e
  )
})()
var lm = new Nl(),
  So = (function () {
    function e() {}
    return (
      a(e, 'ProxyTracerProvider'),
      (e.prototype.getTracer = function (t, r, n) {
        var i
        return (i = this.getDelegateTracer(t, r, n)) !== null && i !== void 0
          ? i
          : new Ml(this, t, r, n)
      }),
      (e.prototype.getDelegate = function () {
        var t
        return (t = this._delegate) !== null && t !== void 0 ? t : lm
      }),
      (e.prototype.setDelegate = function (t) {
        this._delegate = t
      }),
      (e.prototype.getDelegateTracer = function (t, r, n) {
        var i
        return (i = this._delegate) === null || i === void 0
          ? void 0
          : i.getTracer(t, r, n)
      }),
      e
    )
  })()
var Lr
;(function (e) {
  ;(e[(e.INTERNAL = 0)] = 'INTERNAL'),
    (e[(e.SERVER = 1)] = 'SERVER'),
    (e[(e.CLIENT = 2)] = 'CLIENT'),
    (e[(e.PRODUCER = 3)] = 'PRODUCER'),
    (e[(e.CONSUMER = 4)] = 'CONSUMER')
})(Lr || (Lr = {}))
var jr
;(function (e) {
  ;(e[(e.UNSET = 0)] = 'UNSET'),
    (e[(e.OK = 1)] = 'OK'),
    (e[(e.ERROR = 2)] = 'ERROR')
})(jr || (jr = {}))
var Wt = Kt.getInstance()
var de = ot.instance()
var Po = 'trace',
  Rl = (function () {
    function e() {
      ;(this._proxyTracerProvider = new So()),
        (this.wrapSpanContext = Cl),
        (this.isSpanContextValid = ei),
        (this.deleteSpan = Pl),
        (this.getSpan = Xn),
        (this.getActiveSpan = Sl),
        (this.getSpanContext = Zn),
        (this.setSpan = $r),
        (this.setSpanContext = _l)
    }
    return (
      a(e, 'TraceAPI'),
      (e.getInstance = function () {
        return this._instance || (this._instance = new e()), this._instance
      }),
      (e.prototype.setGlobalTracerProvider = function (t) {
        var r = Gt(Po, this._proxyTracerProvider, ot.instance())
        return r && this._proxyTracerProvider.setDelegate(t), r
      }),
      (e.prototype.getTracerProvider = function () {
        return Ve(Po) || this._proxyTracerProvider
      }),
      (e.prototype.getTracer = function (t, r) {
        return this.getTracerProvider().getTracer(t, r)
      }),
      (e.prototype.disable = function () {
        Qt(Po, ot.instance()), (this._proxyTracerProvider = new So())
      }),
      e
    )
  })()
var Et = Rl.getInstance()
var Fl = function (e) {
    var t = typeof Symbol == 'function' && Symbol.iterator,
      r = t && e[t],
      n = 0
    if (r) return r.call(e)
    if (e && typeof e.length == 'number')
      return {
        next: function () {
          return (
            e && n >= e.length && (e = void 0), { value: e && e[n++], done: !e }
          )
        },
      }
    throw new TypeError(
      t ? 'Object is not iterable.' : 'Symbol.iterator is not defined.'
    )
  },
  cm = function (e, t) {
    var r = typeof Symbol == 'function' && e[Symbol.iterator]
    if (!r) return e
    var n = r.call(e),
      i,
      o = [],
      s
    try {
      for (; (t === void 0 || t-- > 0) && !(i = n.next()).done; )
        o.push(i.value)
    } catch (l) {
      s = { error: l }
    } finally {
      try {
        i && !i.done && (r = n.return) && r.call(n)
      } finally {
        if (s) throw s.error
      }
    }
    return o
  }
function Il(e) {
  var t,
    r,
    n = {}
  if (typeof e != 'object' || e == null) return n
  try {
    for (var i = Fl(Object.entries(e)), o = i.next(); !o.done; o = i.next()) {
      var s = cm(o.value, 2),
        l = s[0],
        u = s[1]
      if (!pm(l)) {
        de.warn('Invalid attribute key: ' + l)
        continue
      }
      if (!_o(u)) {
        de.warn('Invalid attribute value set for key: ' + l)
        continue
      }
      Array.isArray(u) ? (n[l] = u.slice()) : (n[l] = u)
    }
  } catch (c) {
    t = { error: c }
  } finally {
    try {
      o && !o.done && (r = i.return) && r.call(i)
    } finally {
      if (t) throw t.error
    }
  }
  return n
}
a(Il, 'sanitizeAttributes')
function pm(e) {
  return typeof e == 'string' && e.length > 0
}
a(pm, 'isAttributeKey')
function _o(e) {
  return e == null ? !0 : Array.isArray(e) ? fm(e) : Dl(e)
}
a(_o, 'isAttributeValue')
function fm(e) {
  var t, r, n
  try {
    for (var i = Fl(e), o = i.next(); !o.done; o = i.next()) {
      var s = o.value
      if (s != null) {
        if (!n) {
          if (Dl(s)) {
            n = typeof s
            continue
          }
          return !1
        }
        if (typeof s !== n) return !1
      }
    }
  } catch (l) {
    t = { error: l }
  } finally {
    try {
      o && !o.done && (r = i.return) && r.call(i)
    } finally {
      if (t) throw t.error
    }
  }
  return !0
}
a(fm, 'isHomogeneousAttributeValueArray')
function Dl(e) {
  switch (typeof e) {
    case 'number':
    case 'boolean':
    case 'string':
      return !0
  }
  return !1
}
a(Dl, 'isValidPrimitiveAttributeValue')
var kl = require('perf_hooks'),
  Jt = kl.performance
var lt = {
  AWS_LAMBDA_INVOKED_ARN: 'aws.lambda.invoked_arn',
  DB_SYSTEM: 'db.system',
  DB_CONNECTION_STRING: 'db.connection_string',
  DB_USER: 'db.user',
  DB_JDBC_DRIVER_CLASSNAME: 'db.jdbc.driver_classname',
  DB_NAME: 'db.name',
  DB_STATEMENT: 'db.statement',
  DB_OPERATION: 'db.operation',
  DB_MSSQL_INSTANCE_NAME: 'db.mssql.instance_name',
  DB_CASSANDRA_KEYSPACE: 'db.cassandra.keyspace',
  DB_CASSANDRA_PAGE_SIZE: 'db.cassandra.page_size',
  DB_CASSANDRA_CONSISTENCY_LEVEL: 'db.cassandra.consistency_level',
  DB_CASSANDRA_TABLE: 'db.cassandra.table',
  DB_CASSANDRA_IDEMPOTENCE: 'db.cassandra.idempotence',
  DB_CASSANDRA_SPECULATIVE_EXECUTION_COUNT:
    'db.cassandra.speculative_execution_count',
  DB_CASSANDRA_COORDINATOR_ID: 'db.cassandra.coordinator.id',
  DB_CASSANDRA_COORDINATOR_DC: 'db.cassandra.coordinator.dc',
  DB_HBASE_NAMESPACE: 'db.hbase.namespace',
  DB_REDIS_DATABASE_INDEX: 'db.redis.database_index',
  DB_MONGODB_COLLECTION: 'db.mongodb.collection',
  DB_SQL_TABLE: 'db.sql.table',
  EXCEPTION_TYPE: 'exception.type',
  EXCEPTION_MESSAGE: 'exception.message',
  EXCEPTION_STACKTRACE: 'exception.stacktrace',
  EXCEPTION_ESCAPED: 'exception.escaped',
  FAAS_TRIGGER: 'faas.trigger',
  FAAS_EXECUTION: 'faas.execution',
  FAAS_DOCUMENT_COLLECTION: 'faas.document.collection',
  FAAS_DOCUMENT_OPERATION: 'faas.document.operation',
  FAAS_DOCUMENT_TIME: 'faas.document.time',
  FAAS_DOCUMENT_NAME: 'faas.document.name',
  FAAS_TIME: 'faas.time',
  FAAS_CRON: 'faas.cron',
  FAAS_COLDSTART: 'faas.coldstart',
  FAAS_INVOKED_NAME: 'faas.invoked_name',
  FAAS_INVOKED_PROVIDER: 'faas.invoked_provider',
  FAAS_INVOKED_REGION: 'faas.invoked_region',
  NET_TRANSPORT: 'net.transport',
  NET_PEER_IP: 'net.peer.ip',
  NET_PEER_PORT: 'net.peer.port',
  NET_PEER_NAME: 'net.peer.name',
  NET_HOST_IP: 'net.host.ip',
  NET_HOST_PORT: 'net.host.port',
  NET_HOST_NAME: 'net.host.name',
  NET_HOST_CONNECTION_TYPE: 'net.host.connection.type',
  NET_HOST_CONNECTION_SUBTYPE: 'net.host.connection.subtype',
  NET_HOST_CARRIER_NAME: 'net.host.carrier.name',
  NET_HOST_CARRIER_MCC: 'net.host.carrier.mcc',
  NET_HOST_CARRIER_MNC: 'net.host.carrier.mnc',
  NET_HOST_CARRIER_ICC: 'net.host.carrier.icc',
  PEER_SERVICE: 'peer.service',
  ENDUSER_ID: 'enduser.id',
  ENDUSER_ROLE: 'enduser.role',
  ENDUSER_SCOPE: 'enduser.scope',
  THREAD_ID: 'thread.id',
  THREAD_NAME: 'thread.name',
  CODE_FUNCTION: 'code.function',
  CODE_NAMESPACE: 'code.namespace',
  CODE_FILEPATH: 'code.filepath',
  CODE_LINENO: 'code.lineno',
  HTTP_METHOD: 'http.method',
  HTTP_URL: 'http.url',
  HTTP_TARGET: 'http.target',
  HTTP_HOST: 'http.host',
  HTTP_SCHEME: 'http.scheme',
  HTTP_STATUS_CODE: 'http.status_code',
  HTTP_FLAVOR: 'http.flavor',
  HTTP_USER_AGENT: 'http.user_agent',
  HTTP_REQUEST_CONTENT_LENGTH: 'http.request_content_length',
  HTTP_REQUEST_CONTENT_LENGTH_UNCOMPRESSED:
    'http.request_content_length_uncompressed',
  HTTP_RESPONSE_CONTENT_LENGTH: 'http.response_content_length',
  HTTP_RESPONSE_CONTENT_LENGTH_UNCOMPRESSED:
    'http.response_content_length_uncompressed',
  HTTP_SERVER_NAME: 'http.server_name',
  HTTP_ROUTE: 'http.route',
  HTTP_CLIENT_IP: 'http.client_ip',
  AWS_DYNAMODB_TABLE_NAMES: 'aws.dynamodb.table_names',
  AWS_DYNAMODB_CONSUMED_CAPACITY: 'aws.dynamodb.consumed_capacity',
  AWS_DYNAMODB_ITEM_COLLECTION_METRICS: 'aws.dynamodb.item_collection_metrics',
  AWS_DYNAMODB_PROVISIONED_READ_CAPACITY:
    'aws.dynamodb.provisioned_read_capacity',
  AWS_DYNAMODB_PROVISIONED_WRITE_CAPACITY:
    'aws.dynamodb.provisioned_write_capacity',
  AWS_DYNAMODB_CONSISTENT_READ: 'aws.dynamodb.consistent_read',
  AWS_DYNAMODB_PROJECTION: 'aws.dynamodb.projection',
  AWS_DYNAMODB_LIMIT: 'aws.dynamodb.limit',
  AWS_DYNAMODB_ATTRIBUTES_TO_GET: 'aws.dynamodb.attributes_to_get',
  AWS_DYNAMODB_INDEX_NAME: 'aws.dynamodb.index_name',
  AWS_DYNAMODB_SELECT: 'aws.dynamodb.select',
  AWS_DYNAMODB_GLOBAL_SECONDARY_INDEXES:
    'aws.dynamodb.global_secondary_indexes',
  AWS_DYNAMODB_LOCAL_SECONDARY_INDEXES: 'aws.dynamodb.local_secondary_indexes',
  AWS_DYNAMODB_EXCLUSIVE_START_TABLE: 'aws.dynamodb.exclusive_start_table',
  AWS_DYNAMODB_TABLE_COUNT: 'aws.dynamodb.table_count',
  AWS_DYNAMODB_SCAN_FORWARD: 'aws.dynamodb.scan_forward',
  AWS_DYNAMODB_SEGMENT: 'aws.dynamodb.segment',
  AWS_DYNAMODB_TOTAL_SEGMENTS: 'aws.dynamodb.total_segments',
  AWS_DYNAMODB_COUNT: 'aws.dynamodb.count',
  AWS_DYNAMODB_SCANNED_COUNT: 'aws.dynamodb.scanned_count',
  AWS_DYNAMODB_ATTRIBUTE_DEFINITIONS: 'aws.dynamodb.attribute_definitions',
  AWS_DYNAMODB_GLOBAL_SECONDARY_INDEX_UPDATES:
    'aws.dynamodb.global_secondary_index_updates',
  MESSAGING_SYSTEM: 'messaging.system',
  MESSAGING_DESTINATION: 'messaging.destination',
  MESSAGING_DESTINATION_KIND: 'messaging.destination_kind',
  MESSAGING_TEMP_DESTINATION: 'messaging.temp_destination',
  MESSAGING_PROTOCOL: 'messaging.protocol',
  MESSAGING_PROTOCOL_VERSION: 'messaging.protocol_version',
  MESSAGING_URL: 'messaging.url',
  MESSAGING_MESSAGE_ID: 'messaging.message_id',
  MESSAGING_CONVERSATION_ID: 'messaging.conversation_id',
  MESSAGING_MESSAGE_PAYLOAD_SIZE_BYTES: 'messaging.message_payload_size_bytes',
  MESSAGING_MESSAGE_PAYLOAD_COMPRESSED_SIZE_BYTES:
    'messaging.message_payload_compressed_size_bytes',
  MESSAGING_OPERATION: 'messaging.operation',
  MESSAGING_CONSUMER_ID: 'messaging.consumer_id',
  MESSAGING_RABBITMQ_ROUTING_KEY: 'messaging.rabbitmq.routing_key',
  MESSAGING_KAFKA_MESSAGE_KEY: 'messaging.kafka.message_key',
  MESSAGING_KAFKA_CONSUMER_GROUP: 'messaging.kafka.consumer_group',
  MESSAGING_KAFKA_CLIENT_ID: 'messaging.kafka.client_id',
  MESSAGING_KAFKA_PARTITION: 'messaging.kafka.partition',
  MESSAGING_KAFKA_TOMBSTONE: 'messaging.kafka.tombstone',
  RPC_SYSTEM: 'rpc.system',
  RPC_SERVICE: 'rpc.service',
  RPC_METHOD: 'rpc.method',
  RPC_GRPC_STATUS_CODE: 'rpc.grpc.status_code',
  RPC_JSONRPC_VERSION: 'rpc.jsonrpc.version',
  RPC_JSONRPC_REQUEST_ID: 'rpc.jsonrpc.request_id',
  RPC_JSONRPC_ERROR_CODE: 'rpc.jsonrpc.error_code',
  RPC_JSONRPC_ERROR_MESSAGE: 'rpc.jsonrpc.error_message',
  MESSAGE_TYPE: 'message.type',
  MESSAGE_ID: 'message.id',
  MESSAGE_COMPRESSED_SIZE: 'message.compressed_size',
  MESSAGE_UNCOMPRESSED_SIZE: 'message.uncompressed_size',
}
var $l = 9,
  ri = Math.pow(10, $l)
function ni(e) {
  var t = e / 1e3,
    r = Math.trunc(t),
    n = Number((t - r).toFixed($l)) * ri
  return [r, n]
}
a(ni, 'numberToHrtime')
function Ll() {
  var e = Jt.timeOrigin
  if (typeof e != 'number') {
    var t = Jt
    e = t.timing && t.timing.fetchStart
  }
  return e
}
a(Ll, 'getTimeOrigin')
function dm(e) {
  var t = ni(Ll()),
    r = ni(typeof e == 'number' ? e : Jt.now()),
    n = t[0] + r[0],
    i = t[1] + r[1]
  return i > ri && ((i -= ri), (n += 1)), [n, i]
}
a(dm, 'hrTime')
function ii(e) {
  if (Bl(e)) return e
  if (typeof e == 'number') return e < Ll() ? dm(e) : ni(e)
  if (e instanceof Date) return ni(e.getTime())
  throw TypeError('Invalid input type')
}
a(ii, 'timeInputToHrTime')
function jl(e, t) {
  var r = t[0] - e[0],
    n = t[1] - e[1]
  return n < 0 && ((r -= 1), (n += ri)), [r, n]
}
a(jl, 'hrTimeDuration')
function Bl(e) {
  return (
    Array.isArray(e) &&
    e.length === 2 &&
    typeof e[0] == 'number' &&
    typeof e[1] == 'number'
  )
}
a(Bl, 'isTimeInputHrTime')
function ql(e) {
  return Bl(e) || typeof e == 'number' || e instanceof Date
}
a(ql, 'isTimeInput')
var Vl = 'exception'
var mm = function (e) {
    var t = typeof Symbol == 'function' && Symbol.iterator,
      r = t && e[t],
      n = 0
    if (r) return r.call(e)
    if (e && typeof e.length == 'number')
      return {
        next: function () {
          return (
            e && n >= e.length && (e = void 0), { value: e && e[n++], done: !e }
          )
        },
      }
    throw new TypeError(
      t ? 'Object is not iterable.' : 'Symbol.iterator is not defined.'
    )
  },
  gm = function (e, t) {
    var r = typeof Symbol == 'function' && e[Symbol.iterator]
    if (!r) return e
    var n = r.call(e),
      i,
      o = [],
      s
    try {
      for (; (t === void 0 || t-- > 0) && !(i = n.next()).done; )
        o.push(i.value)
    } catch (l) {
      s = { error: l }
    } finally {
      try {
        i && !i.done && (r = n.return) && r.call(n)
      } finally {
        if (s) throw s.error
      }
    }
    return o
  },
  Ul = (function () {
    function e(t, r, n, i, o, s, l, u, c) {
      l === void 0 && (l = []),
        c === void 0 && (c = Jt),
        (this.attributes = {}),
        (this.links = []),
        (this.events = []),
        (this.status = { code: jr.UNSET }),
        (this.endTime = [0, 0]),
        (this._ended = !1),
        (this._duration = [-1, -1]),
        (this._clock = c),
        (this.name = n),
        (this._spanContext = i),
        (this.parentSpanId = s),
        (this.kind = o),
        (this.links = l),
        (this.startTime = ii(u ?? c.now())),
        (this.resource = t.resource),
        (this.instrumentationLibrary = t.instrumentationLibrary),
        (this._spanLimits = t.getSpanLimits()),
        (this._spanProcessor = t.getActiveSpanProcessor()),
        this._spanProcessor.onStart(this, r),
        (this._attributeValueLengthLimit =
          this._spanLimits.attributeValueLengthLimit || 0)
    }
    return (
      a(e, 'Span'),
      (e.prototype.spanContext = function () {
        return this._spanContext
      }),
      (e.prototype.setAttribute = function (t, r) {
        return r == null || this._isSpanEnded()
          ? this
          : t.length === 0
          ? (de.warn('Invalid attribute key: ' + t), this)
          : _o(r)
          ? Object.keys(this.attributes).length >=
              this._spanLimits.attributeCountLimit &&
            !Object.prototype.hasOwnProperty.call(this.attributes, t)
            ? this
            : ((this.attributes[t] = this._truncateToSize(r)), this)
          : (de.warn('Invalid attribute value set for key: ' + t), this)
      }),
      (e.prototype.setAttributes = function (t) {
        var r, n
        try {
          for (
            var i = mm(Object.entries(t)), o = i.next();
            !o.done;
            o = i.next()
          ) {
            var s = gm(o.value, 2),
              l = s[0],
              u = s[1]
            this.setAttribute(l, u)
          }
        } catch (c) {
          r = { error: c }
        } finally {
          try {
            o && !o.done && (n = i.return) && n.call(i)
          } finally {
            if (r) throw r.error
          }
        }
        return this
      }),
      (e.prototype.addEvent = function (t, r, n) {
        if (this._isSpanEnded()) return this
        if (this._spanLimits.eventCountLimit === 0)
          return de.warn('No events allowed.'), this
        this.events.length >= this._spanLimits.eventCountLimit &&
          (de.warn('Dropping extra events.'), this.events.shift()),
          ql(r) && (typeof n > 'u' && (n = r), (r = void 0)),
          typeof n > 'u' && (n = this._clock.now())
        var i = Il(r)
        return this.events.push({ name: t, attributes: i, time: ii(n) }), this
      }),
      (e.prototype.setStatus = function (t) {
        return this._isSpanEnded() ? this : ((this.status = t), this)
      }),
      (e.prototype.updateName = function (t) {
        return this._isSpanEnded() ? this : ((this.name = t), this)
      }),
      (e.prototype.end = function (t) {
        if (this._isSpanEnded()) {
          de.error('You can only call end() on a span once.')
          return
        }
        ;(this._ended = !0),
          (this.endTime = ii(t ?? this._clock.now())),
          (this._duration = jl(this.startTime, this.endTime)),
          this._duration[0] < 0 &&
            (de.warn(
              'Inconsistent start and end time, startTime > endTime. Setting span duration to 0ms.',
              this.startTime,
              this.endTime
            ),
            (this.endTime = this.startTime.slice()),
            (this._duration = [0, 0])),
          this._spanProcessor.onEnd(this)
      }),
      (e.prototype.isRecording = function () {
        return this._ended === !1
      }),
      (e.prototype.recordException = function (t, r) {
        r === void 0 && (r = this._clock.now())
        var n = {}
        typeof t == 'string'
          ? (n[lt.EXCEPTION_MESSAGE] = t)
          : t &&
            (t.code
              ? (n[lt.EXCEPTION_TYPE] = t.code.toString())
              : t.name && (n[lt.EXCEPTION_TYPE] = t.name),
            t.message && (n[lt.EXCEPTION_MESSAGE] = t.message),
            t.stack && (n[lt.EXCEPTION_STACKTRACE] = t.stack)),
          n[lt.EXCEPTION_TYPE] || n[lt.EXCEPTION_MESSAGE]
            ? this.addEvent(Vl, n, r)
            : de.warn('Failed to record an exception ' + t)
      }),
      Object.defineProperty(e.prototype, 'duration', {
        get: function () {
          return this._duration
        },
        enumerable: !1,
        configurable: !0,
      }),
      Object.defineProperty(e.prototype, 'ended', {
        get: function () {
          return this._ended
        },
        enumerable: !1,
        configurable: !0,
      }),
      (e.prototype._isSpanEnded = function () {
        return (
          this._ended &&
            de.warn(
              'Can not execute the operation on ended Span {traceId: ' +
                this._spanContext.traceId +
                ', spanId: ' +
                this._spanContext.spanId +
                '}'
            ),
          this._ended
        )
      }),
      (e.prototype._truncateToLimitUtil = function (t, r) {
        return t.length <= r ? t : t.substr(0, r)
      }),
      (e.prototype._truncateToSize = function (t) {
        var r = this,
          n = this._attributeValueLengthLimit
        return n <= 0
          ? (de.warn('Attribute value limit must be positive, got ' + n), t)
          : typeof t == 'string'
          ? this._truncateToLimitUtil(t, n)
          : Array.isArray(t)
          ? t.map(function (i) {
              return typeof i == 'string' ? r._truncateToLimitUtil(i, n) : i
            })
          : t
      }),
      e
    )
  })()
async function Co(e) {
  await new Promise((r) => setTimeout(r, 0))
  let t = Et.getTracer('prisma')
  e.spans.forEach((r) => {
    let n = { traceId: r.trace_id, spanId: r.span_id, traceFlags: st.SAMPLED },
      i = r.links?.map((s) => ({
        context: {
          traceId: s.trace_id,
          spanId: s.span_id,
          traceFlags: st.SAMPLED,
        },
      })),
      o = new Ul(
        t,
        kr,
        r.name,
        n,
        Lr.INTERNAL,
        r.parent_span_id,
        i,
        r.start_time
      )
    r.attributes && o.setAttributes(r.attributes), o.end(r.end_time)
  })
}
a(Co, 'createSpan')
function De({ context: e, tracingConfig: t }) {
  let r = Et.getSpanContext(e ?? Wt.active())
  return t?.enabled && r
    ? `00-${r.traceId}-${r.spanId}-0${r.traceFlags}`
    : '00-10-10-00'
}
a(De, 'getTraceParent')
function Oo(e) {
  let t = e.includes('tracing')
  return {
    get enabled() {
      return Boolean(globalThis.PRISMA_INSTRUMENTATION && t)
    },
    get middleware() {
      return Boolean(
        globalThis.PRISMA_INSTRUMENTATION &&
          globalThis.PRISMA_INSTRUMENTATION.middleware
      )
    },
  }
}
a(Oo, 'getTracingConfig')
var hm = process.env.PRISMA_SHOW_ALL_TRACES === 'true'
async function me(e, t) {
  if (e.enabled === !1 || (e.internal && !hm)) return t()
  let r = Et.getTracer('prisma'),
    n = e.context ?? Wt.active()
  if (e.active === !1) {
    let i = r.startSpan(`prisma:client:${e.name}`, e, n)
    try {
      return await t(i, n)
    } finally {
      i.end()
    }
  }
  return r.startActiveSpan(`prisma:client:${e.name}`, e, n, async (i) => {
    try {
      return await t(i, Wt.active())
    } finally {
      i.end()
    }
  })
}
a(me, 'runInChildSpan')
function Br(e) {
  return typeof e.batchRequestIdx == 'number'
}
a(Br, 'hasBatchIndex')
var Gl = O(ae())
function Ql(e) {
  let t = e.e,
    r = a(
      (l) =>
        `Prisma cannot find the required \`${l}\` system library in your system`,
      'systemLibraryNotFound'
    ),
    n = t.message.includes('cannot open shared object file'),
    i = `Please refer to the documentation about Prisma's system requirements: ${Or(
      'https://pris.ly/d/system-requirements'
    )}`,
    o = `Unable to require(\`${Gl.default.dim(e.id)}\`).`,
    s = qt({ message: t.message, code: t.code })
      .with({ code: 'ENOENT' }, () => 'File does not exist.')
      .when(
        ({ message: l }) => n && l.includes('libz'),
        () => `${r('libz')}. Please install it and try again.`
      )
      .when(
        ({ message: l }) => n && l.includes('libgcc_s'),
        () => `${r('libgcc_s')}. Please install it and try again.`
      )
      .when(
        ({ message: l }) => n && l.includes('libssl'),
        () => {
          let l = e.platformInfo.libssl
            ? `openssl-${e.platformInfo.libssl}`
            : 'openssl'
          return `${r('libssl')}. Please install ${l} and try again.`
        }
      )
      .when(
        ({ message: l }) => l.includes('GLIBC'),
        () =>
          `Prisma has detected an incompatible version of the \`glibc\` C standard library installed in your system. This probably means your system may be too old to run Prisma. ${i}`
      )
      .when(
        ({ message: l }) =>
          e.platformInfo.platform === 'linux' && l.includes('symbol not found'),
        () =>
          `The Prisma engines are not compatible with your system ${e.platformInfo.originalDistro} on (${e.platformInfo.archFromUname}) which uses the \`${e.platformInfo.binaryTarget}\` binaryTarget by default. ${i}`
      )
      .otherwise(
        () =>
          `The Prisma engines do not seem to be compatible with your system. ${i}`
      )
  return `${o}
${s}

Details: ${t.message}`
}
a(Ql, 'handleLibraryLoadingErrors')
var Yt = O(ae()),
  Yl = O(require('fs'))
function Kl(e) {
  if (e?.kind === 'itx') return e.options.id
}
a(Kl, 'getInteractiveTransactionId')
var ke = O(ae()),
  Ht = O(require('fs')),
  wt = O(require('path'))
var Wl = U('prisma:client:libraryEngine:loader')
function ym(id) {
  return eval('require')(id)
}
a(ym, 'load')
var qr = class {
  constructor(e) {
    this.libQueryEnginePath = null
    this.platform = null
    this.config = e
  }
  async loadLibrary() {
    let e = await ho()
    ;(this.platform = e.binaryTarget),
      this.libQueryEnginePath ||
        (this.libQueryEnginePath = await this.getLibQueryEnginePath()),
      Wl(`loadEngine using ${this.libQueryEnginePath}`)
    try {
      let t = this.libQueryEnginePath
      return me(
        {
          name: 'loadLibrary',
          enabled: this.config.tracingConfig.enabled,
          internal: !0,
        },
        () => ym(t)
      )
    } catch (t) {
      let r = Ql({ e: t, platformInfo: e, id: this.libQueryEnginePath })
      throw new G(r, this.config.clientVersion)
    }
  }
  async getLibQueryEnginePath() {
    let e = process.env.PRISMA_QUERY_ENGINE_LIBRARY ?? this.config.prismaPath
    if (e && Ht.default.existsSync(e) && e.endsWith('.node')) return e
    this.platform = this.platform ?? (await rt())
    let { enginePath: t, searchedLocations: r } = await this.resolveEnginePath()
    if (!Ht.default.existsSync(t)) {
      let n = this.platform
          ? `
You incorrectly pinned it to ${ke.default.redBright.bold(`${this.platform}`)}
`
          : '',
        i = `Query engine library for current platform "${ke.default.bold(
          this.platform
        )}" could not be found.${n}
This probably happens, because you built Prisma Client on a different platform.
(Prisma Client looked in "${ke.default.underline(t)}")

Searched Locations:

${r
  .map((o) => {
    let s = `  ${o}`
    if (
      process.env.DEBUG === 'node-engine-search-locations' &&
      Ht.default.existsSync(o)
    ) {
      let l = Ht.default.readdirSync(o)
      s += l.map((u) => `    ${u}`).join(`
`)
    }
    return s
  })
  .join(
    `
` +
      (process.env.DEBUG === 'node-engine-search-locations'
        ? `
`
        : '')
  )}
`
      throw (
        (this.config.generator
          ? ((this.platform = this.platform ?? (await rt())),
            this.config.generator.binaryTargets.find(
              (o) => o.value === this.platform
            ) ||
            this.config.generator.binaryTargets.find(
              (o) => o.value === 'native'
            )
              ? ((i += `
You already added the platform${
                  this.config.generator.binaryTargets.length > 1 ? 's' : ''
                } ${this.config.generator.binaryTargets
                  .map((o) => `"${ke.default.bold(o.value)}"`)
                  .join(', ')} to the "${ke.default.underline(
                  'generator'
                )}" block
in the "schema.prisma" file as described in https://pris.ly/d/client-generator,
but something went wrong. That's suboptimal.

Please create an issue at https://github.com/prisma/prisma/issues/new`),
                (i += ''))
              : (i += `

To solve this problem, add the platform "${
                  this.platform
                }" to the "${ke.default.underline(
                  'binaryTargets'
                )}" attribute in the "${ke.default.underline(
                  'generator'
                )}" block in the "schema.prisma" file:
${ke.default.greenBright(this.getFixedGenerator())}

Then run "${ke.default.greenBright(
                  'prisma generate'
                )}" for your changes to take effect.
Read more about deploying Prisma Client: https://pris.ly/d/client-generator`))
          : (i += `

Read more about deploying Prisma Client: https://pris.ly/d/client-generator
`),
        new G(i, this.config.clientVersion))
      )
    }
    return (this.platform = this.platform ?? (await rt())), t
  }
  async resolveEnginePath() {
    let searchedLocations = [],
      enginePath
    if (this.libQueryEnginePath)
      return { enginePath: this.libQueryEnginePath, searchedLocations }
    if (
      ((this.platform = this.platform ?? (await rt())),
      __filename.includes('DefaultLibraryLoader'))
    )
      return (
        (enginePath = wt.default.join(tl(), Pr(this.platform, 'fs'))),
        { enginePath, searchedLocations }
      )
    let dirname = eval('__dirname'),
      searchLocations = [
        wt.default.resolve(dirname, '../../../.prisma/client'),
        this.config.generator?.output?.value ?? dirname,
        wt.default.resolve(dirname, '..'),
        wt.default.dirname(this.config.datamodelPath),
        this.config.cwd,
        '/tmp/prisma-engines',
      ]
    this.config.dirname && searchLocations.push(this.config.dirname)
    for (let e of searchLocations)
      if (
        (searchedLocations.push(e),
        Wl(`Searching for Query Engine Library in ${e}`),
        (enginePath = wt.default.join(e, Pr(this.platform, 'fs'))),
        Ht.default.existsSync(enginePath))
      )
        return { enginePath, searchedLocations }
    return (
      (enginePath = wt.default.join(__dirname, Pr(this.platform, 'fs'))),
      { enginePath, searchedLocations }
    )
  }
  getFixedGenerator() {
    let e = {
      ...this.config.generator,
      binaryTargets: ll(this.config.generator.binaryTargets, this.platform),
    }
    return yl(e)
  }
}
a(qr, 'DefaultLibraryLoader')
var bm = U('prisma:client:libraryEngine:exitHooks'),
  Vr = class {
    constructor() {
      this.nextOwnerId = 1
      this.ownerToIdMap = new WeakMap()
      this.idToListenerMap = new Map()
      this.areHooksInstalled = !1
    }
    install() {
      this.areHooksInstalled ||
        (this.installHook('beforeExit'),
        this.installHook('exit'),
        this.installHook('SIGINT', !0),
        this.installHook('SIGUSR2', !0),
        this.installHook('SIGTERM', !0),
        (this.areHooksInstalled = !0))
    }
    setListener(t, r) {
      if (r) {
        let n = this.ownerToIdMap.get(t)
        n || ((n = this.nextOwnerId++), this.ownerToIdMap.set(t, n)),
          this.idToListenerMap.set(n, r)
      } else {
        let n = this.ownerToIdMap.get(t)
        n !== void 0 &&
          (this.ownerToIdMap.delete(t), this.idToListenerMap.delete(n))
      }
    }
    getListener(t) {
      let r = this.ownerToIdMap.get(t)
      if (r !== void 0) return this.idToListenerMap.get(r)
    }
    installHook(t, r = !1) {
      process.once(t, async (n) => {
        bm(`exit event received: ${t}`)
        for (let i of this.idToListenerMap.values()) await i()
        this.idToListenerMap.clear(),
          r && process.listenerCount(t) === 0 && process.exit(n)
      })
    }
  }
a(Vr, 'ExitHooks')
var Ue = U('prisma:client:libraryEngine')
function Em(e) {
  return e.item_type === 'query' && 'query' in e
}
a(Em, 'isQueryEvent')
function wm(e) {
  return 'level' in e ? e.level === 'error' && e.message === 'PANIC' : !1
}
a(wm, 'isPanicEvent')
var Jl = [...bo, 'native'],
  Hl = 0,
  Mo = new Vr(),
  zt = class extends nt {
    constructor(r, n = new qr(r)) {
      super()
      try {
        this.datamodel = Yl.default.readFileSync(r.datamodelPath, 'utf-8')
      } catch (i) {
        throw i.stack.match(/\/\.next|\/next@|\/next\//)
          ? new G(
              `Your schema.prisma could not be found, and we detected that you are using Next.js.
Find out why and learn how to fix this: https://pris.ly/d/schema-not-found-nextjs`,
              r.clientVersion
            )
          : i
      }
      ;(this.config = r),
        (this.libraryStarted = !1),
        (this.logQueries = r.logQueries ?? !1),
        (this.logLevel = r.logLevel ?? 'error'),
        (this.libraryLoader = n),
        (this.logEmitter = r.logEmitter),
        (this.engineProtocol = r.engineProtocol),
        (this.datasourceOverrides = r.datasources
          ? this.convertDatasources(r.datasources)
          : {}),
        r.enableDebugLogs && (this.logLevel = 'debug'),
        (this.libraryInstantiationPromise = this.instantiateLibrary()),
        Mo.install(),
        this.checkForTooManyEngines()
    }
    get beforeExitListener() {
      return Mo.getListener(this)
    }
    set beforeExitListener(r) {
      Mo.setListener(this, r)
    }
    checkForTooManyEngines() {
      Hl === 10 &&
        console.warn(
          `${Yt.default.yellow(
            'warn(prisma-client)'
          )} There are already 10 instances of Prisma Client actively running.`
        )
    }
    async transaction(r, n, i) {
      await this.start()
      let o = JSON.stringify(n),
        s
      if (r === 'start') {
        let u = JSON.stringify({
          max_wait: i?.maxWait ?? 2e3,
          timeout: i?.timeout ?? 5e3,
          isolation_level: i?.isolationLevel,
        })
        s = await this.engine?.startTransaction(u, o)
      } else
        r === 'commit'
          ? (s = await this.engine?.commitTransaction(i.id, o))
          : r === 'rollback' &&
            (s = await this.engine?.rollbackTransaction(i.id, o))
      let l = this.parseEngineResponse(s)
      if (l.error_code)
        throw new X(l.message, {
          code: l.error_code,
          clientVersion: this.config.clientVersion,
          meta: l.meta,
        })
      return l
    }
    async instantiateLibrary() {
      if ((Ue('internalSetup'), this.libraryInstantiationPromise))
        return this.libraryInstantiationPromise
      await yo(),
        (this.platform = await this.getPlatform()),
        await this.loadEngine(),
        this.version()
    }
    async getPlatform() {
      if (this.platform) return this.platform
      let r = await rt()
      if (!Jl.includes(r))
        throw new G(
          `Unknown ${Yt.default.red(
            'PRISMA_QUERY_ENGINE_LIBRARY'
          )} ${Yt.default.redBright.bold(
            r
          )}. Possible binaryTargets: ${Yt.default.greenBright(
            Jl.join(', ')
          )} or a path to the query engine library.
You may have to run ${Yt.default.greenBright(
            'prisma generate'
          )} for your changes to take effect.`,
          this.config.clientVersion
        )
      return r
    }
    parseEngineResponse(r) {
      if (!r)
        throw new Z('Response from the Engine was empty', {
          clientVersion: this.config.clientVersion,
        })
      try {
        return JSON.parse(r)
      } catch {
        throw new Z('Unable to JSON.parse response from engine', {
          clientVersion: this.config.clientVersion,
        })
      }
    }
    convertDatasources(r) {
      let n = Object.create(null)
      for (let { name: i, url: o } of r) n[i] = o
      return n
    }
    async loadEngine() {
      if (!this.engine) {
        this.QueryEngineConstructor ||
          ((this.library = await this.libraryLoader.loadLibrary()),
          (this.QueryEngineConstructor = this.library.QueryEngine))
        try {
          let r = new WeakRef(this)
          ;(this.engine = new this.QueryEngineConstructor(
            {
              datamodel: this.datamodel,
              env: process.env,
              logQueries: this.config.logQueries ?? !1,
              ignoreEnvVarErrors: !0,
              datasourceOverrides: this.datasourceOverrides,
              logLevel: this.logLevel,
              configDir: this.config.cwd,
              engineProtocol: this.engineProtocol,
            },
            (n) => {
              r.deref()?.logger(n)
            }
          )),
            Hl++
        } catch (r) {
          let n = r,
            i = this.parseInitError(n.message)
          throw typeof i == 'string'
            ? n
            : new G(i.message, this.config.clientVersion, i.error_code)
        }
      }
    }
    logger(r) {
      let n = this.parseEngineResponse(r)
      if (!!n) {
        if ('span' in n) {
          this.config.tracingConfig.enabled === !0 && Co(n)
          return
        }
        ;(n.level = n?.level.toLowerCase() ?? 'unknown'),
          Em(n)
            ? this.logEmitter.emit('query', {
                timestamp: new Date(),
                query: n.query,
                params: n.params,
                duration: Number(n.duration_ms),
                target: n.module_path,
              })
            : wm(n)
            ? (this.loggerRustPanic = new fe(
                this.getErrorMessageWithLink(
                  `${n.message}: ${n.reason} in ${n.file}:${n.line}:${n.column}`
                ),
                this.config.clientVersion
              ))
            : this.logEmitter.emit(n.level, {
                timestamp: new Date(),
                message: n.message,
                target: n.module_path,
              })
      }
    }
    getErrorMessageWithLink(r) {
      return dl({
        platform: this.platform,
        title: r,
        version: this.config.clientVersion,
        engineVersion: this.versionInfo?.commit,
        database: this.config.activeProvider,
        query: this.lastQuery,
      })
    }
    parseInitError(r) {
      try {
        return JSON.parse(r)
      } catch {}
      return r
    }
    parseRequestError(r) {
      try {
        return JSON.parse(r)
      } catch {}
      return r
    }
    on(r, n) {
      r === 'beforeExit'
        ? (this.beforeExitListener = n)
        : this.logEmitter.on(r, n)
    }
    async start() {
      if (
        (await this.libraryInstantiationPromise,
        await this.libraryStoppingPromise,
        this.libraryStartingPromise)
      )
        return (
          Ue(
            `library already starting, this.libraryStarted: ${this.libraryStarted}`
          ),
          this.libraryStartingPromise
        )
      if (this.libraryStarted) return
      let r = a(async () => {
          Ue('library starting')
          try {
            let i = {
              traceparent: De({ tracingConfig: this.config.tracingConfig }),
            }
            await this.engine?.connect(JSON.stringify(i)),
              (this.libraryStarted = !0),
              Ue('library started')
          } catch (i) {
            let o = this.parseInitError(i.message)
            throw typeof o == 'string'
              ? i
              : new G(o.message, this.config.clientVersion, o.error_code)
          } finally {
            this.libraryStartingPromise = void 0
          }
        }, 'startFn'),
        n = { name: 'connect', enabled: this.config.tracingConfig.enabled }
      return (
        (this.libraryStartingPromise = me(n, r)), this.libraryStartingPromise
      )
    }
    async stop() {
      if (
        (await this.libraryStartingPromise,
        await this.executingQueryPromise,
        this.libraryStoppingPromise)
      )
        return Ue('library is already stopping'), this.libraryStoppingPromise
      if (!this.libraryStarted) return
      let r = a(async () => {
          await new Promise((o) => setTimeout(o, 5)), Ue('library stopping')
          let i = {
            traceparent: De({ tracingConfig: this.config.tracingConfig }),
          }
          await this.engine?.disconnect(JSON.stringify(i)),
            (this.libraryStarted = !1),
            (this.libraryStoppingPromise = void 0),
            Ue('library stopped')
        }, 'stopFn'),
        n = { name: 'disconnect', enabled: this.config.tracingConfig.enabled }
      return (
        (this.libraryStoppingPromise = me(n, r)), this.libraryStoppingPromise
      )
    }
    async getDmmf() {
      await this.start()
      let r = De({ tracingConfig: this.config.tracingConfig }),
        n = await this.engine.dmmf(JSON.stringify({ traceparent: r }))
      return me(
        {
          name: 'parseDmmf',
          enabled: this.config.tracingConfig.enabled,
          internal: !0,
        },
        () => JSON.parse(n)
      )
    }
    version() {
      return (
        (this.versionInfo = this.library?.version()),
        this.versionInfo?.version ?? 'unknown'
      )
    }
    debugPanic(r) {
      return this.library?.debugPanic(r)
    }
    async request(r, { traceparent: n, interactiveTransaction: i }) {
      Ue(`sending request, this.libraryStarted: ${this.libraryStarted}`)
      let o = JSON.stringify({ traceparent: n }),
        s = JSON.stringify(r)
      try {
        await this.start(),
          (this.executingQueryPromise = this.engine?.query(s, o, i?.id)),
          (this.lastQuery = s)
        let l = this.parseEngineResponse(await this.executingQueryPromise)
        if (l.errors)
          throw l.errors.length === 1
            ? this.buildQueryError(l.errors[0])
            : new Z(JSON.stringify(l.errors), {
                clientVersion: this.config.clientVersion,
              })
        if (this.loggerRustPanic) throw this.loggerRustPanic
        return { data: l, elapsed: 0 }
      } catch (l) {
        if (l instanceof G) throw l
        if (l.code === 'GenericFailure' && l.message?.startsWith('PANIC:'))
          throw new fe(
            this.getErrorMessageWithLink(l.message),
            this.config.clientVersion
          )
        let u = this.parseRequestError(l.message)
        throw typeof u == 'string'
          ? l
          : new Z(
              `${u.message}
${u.backtrace}`,
              { clientVersion: this.config.clientVersion }
            )
      }
    }
    async requestBatch(r, { transaction: n, traceparent: i }) {
      Ue('requestBatch')
      let o = gl(r, n)
      await this.start(),
        (this.lastQuery = JSON.stringify(o)),
        (this.executingQueryPromise = this.engine.query(
          this.lastQuery,
          JSON.stringify({ traceparent: i }),
          Kl(n)
        ))
      let s = await this.executingQueryPromise,
        l = this.parseEngineResponse(s)
      if (l.errors)
        throw l.errors.length === 1
          ? this.buildQueryError(l.errors[0])
          : new Z(JSON.stringify(l.errors), {
              clientVersion: this.config.clientVersion,
            })
      let { batchResult: u, errors: c } = l
      if (Array.isArray(u))
        return u.map((p) =>
          p.errors && p.errors.length > 0
            ? this.loggerRustPanic ?? this.buildQueryError(p.errors[0])
            : { data: p, elapsed: 0 }
        )
      throw c && c.length === 1
        ? new Error(c[0].error)
        : new Error(JSON.stringify(l))
    }
    buildQueryError(r) {
      return r.user_facing_error.is_panic
        ? new fe(
            this.getErrorMessageWithLink(r.user_facing_error.message),
            this.config.clientVersion
          )
        : ml(r, this.config.clientVersion)
    }
    async metrics(r) {
      await this.start()
      let n = await this.engine.metrics(JSON.stringify(r))
      return r.format === 'prometheus' ? n : this.parseEngineResponse(n)
    }
  }
a(zt, 'LibraryEngine')
var ge = O(ae()),
  Fo = O(Zl()),
  ai = O(require('fs')),
  Xt = O(require('path'))
function eu(e) {
  let t = e.ignoreProcessEnv ? {} : process.env,
    r = a(
      (n) =>
        n.match(/(.?\${(?:[a-zA-Z0-9_]+)?})/g)?.reduce(function (o, s) {
          let l = /(.?)\${([a-zA-Z0-9_]+)?}/g.exec(s)
          if (!l) return o
          let u = l[1],
            c,
            p
          if (u === '\\') (p = l[0]), (c = p.replace('\\$', '$'))
          else {
            let f = l[2]
            ;(p = l[0].substring(u.length)),
              (c = Object.hasOwnProperty.call(t, f) ? t[f] : e.parsed[f] || ''),
              (c = r(c))
          }
          return o.replace(p, c)
        }, n) ?? n,
      'interpolate'
    )
  for (let n in e.parsed) {
    let i = Object.hasOwnProperty.call(t, n) ? t[n] : e.parsed[n]
    e.parsed[n] = r(i)
  }
  for (let n in e.parsed) t[n] = e.parsed[n]
  return e
}
a(eu, 'dotenvExpand')
var Ro = U('prisma:tryLoadEnv')
function Ur(
  { rootEnvPath: e, schemaEnvPath: t },
  r = { conflictCheck: 'none' }
) {
  let n = tu(e)
  r.conflictCheck !== 'none' && Mm(n, t, r.conflictCheck)
  let i = null
  return (
    ru(n?.path, t) || (i = tu(t)),
    !n && !i && Ro('No Environment variables loaded'),
    i?.dotenvResult.error
      ? console.error(
          ge.default.redBright.bold('Schema Env Error: ') + i.dotenvResult.error
        )
      : {
          message: [n?.message, i?.message].filter(Boolean).join(`
`),
          parsed: { ...n?.dotenvResult?.parsed, ...i?.dotenvResult?.parsed },
        }
  )
}
a(Ur, 'tryLoadEnvs')
function Mm(e, t, r) {
  let n = e?.dotenvResult.parsed,
    i = !ru(e?.path, t)
  if (n && t && i && ai.default.existsSync(t)) {
    let o = Fo.default.parse(ai.default.readFileSync(t)),
      s = []
    for (let l in o) n[l] === o[l] && s.push(l)
    if (s.length > 0) {
      let l = Xt.default.relative(process.cwd(), e.path),
        u = Xt.default.relative(process.cwd(), t)
      if (r === 'error') {
        let c = `There is a conflict between env var${
          s.length > 1 ? 's' : ''
        } in ${ge.default.underline(l)} and ${ge.default.underline(u)}
Conflicting env vars:
${s.map((p) => `  ${ge.default.bold(p)}`).join(`
`)}

We suggest to move the contents of ${ge.default.underline(
          u
        )} to ${ge.default.underline(l)} to consolidate your env vars.
`
        throw new Error(c)
      } else if (r === 'warn') {
        let c = `Conflict for env var${s.length > 1 ? 's' : ''} ${s
          .map((p) => ge.default.bold(p))
          .join(', ')} in ${ge.default.underline(l)} and ${ge.default.underline(
          u
        )}
Env vars from ${ge.default.underline(
          u
        )} overwrite the ones from ${ge.default.underline(l)}
      `
        console.warn(`${ge.default.yellow('warn(prisma)')} ${c}`)
      }
    }
  }
}
a(Mm, 'checkForConflicts')
function tu(e) {
  return Nm(e)
    ? (Ro(`Environment variables loaded from ${e}`),
      {
        dotenvResult: eu(
          Fo.default.config({
            path: e,
            debug: process.env.DOTENV_CONFIG_DEBUG ? !0 : void 0,
          })
        ),
        message: ge.default.dim(
          `Environment variables loaded from ${Xt.default.relative(
            process.cwd(),
            e
          )}`
        ),
        path: e,
      })
    : (Ro(`Environment variables not found at ${e}`), null)
}
a(tu, 'loadEnv')
function ru(e, t) {
  return e && t && Xt.default.resolve(e) === Xt.default.resolve(t)
}
a(ru, 'pathsEqual')
function Nm(e) {
  return Boolean(e && ai.default.existsSync(e))
}
a(Nm, 'exists')
var nu = 'library'
function Io(e) {
  let t = Rm()
  return (
    t ||
    (e?.config.engineType === 'library'
      ? 'library'
      : e?.config.engineType === 'binary'
      ? 'binary'
      : nu)
  )
}
a(Io, 'getClientEngineType')
function Rm() {
  let e = process.env.PRISMA_CLIENT_ENGINE_TYPE
  return e === 'library' ? 'library' : e === 'binary' ? 'binary' : void 0
}
a(Rm, 'getEngineTypeFromEnvVar')
var Im = O(ou()),
  Dm = O(ko())
function Qr(e) {
  return e instanceof Error
}
a(Qr, 'isError')
function $o(e) {
  let t = process.env.PRISMA_ENGINE_PROTOCOL
  if (t === 'json' || t == 'graphql') return t
  if (t !== void 0)
    throw new Error(
      `Invalid PRISMA_ENGINE_PROTOCOL env variable value. Expected 'graphql' or 'json', got '${t}'`
    )
  return e?.previewFeatures?.includes('jsonProtocol') ? 'json' : 'graphql'
}
a($o, 'getQueryEngineProtocol')
var Jr = {}
gn(Jr, {
  error: () => Lm,
  info: () => $m,
  log: () => km,
  query: () => jm,
  should: () => uu,
  tags: () => Wr,
  warn: () => Lo,
})
var Kr = O(ae())
var Wr = {
    error: Kr.default.red('prisma:error'),
    warn: Kr.default.yellow('prisma:warn'),
    info: Kr.default.cyan('prisma:info'),
    query: Kr.default.blue('prisma:query'),
  },
  uu = { warn: () => !process.env.PRISMA_DISABLE_WARNINGS }
function km(...e) {
  console.log(...e)
}
a(km, 'log')
function Lo(e, ...t) {
  uu.warn() && console.warn(`${Wr.warn} ${e}`, ...t)
}
a(Lo, 'warn')
function $m(e, ...t) {
  console.info(`${Wr.info} ${e}`, ...t)
}
a($m, 'info')
function Lm(e, ...t) {
  console.error(`${Wr.error} ${e}`, ...t)
}
a(Lm, 'error')
function jm(e, ...t) {
  console.log(`${Wr.query} ${e}`, ...t)
}
a(jm, 'query')
function Ge(e, t) {
  throw new Error(t)
}
a(Ge, 'assertNever')
function li(e) {
  let t
  return (...r) => t ?? (t = e(...r))
}
a(li, 'callOnce')
function jo(e, t) {
  return Object.prototype.hasOwnProperty.call(e, t)
}
a(jo, 'hasOwnProperty')
var Bo = a((e, t) => e.reduce((r, n) => ((r[t(n)] = n), r), {}), 'keyBy')
function Zt(e, t) {
  return Object.fromEntries(Object.entries(e).map(([r, n]) => [r, t(n, r)]))
}
a(Zt, 'mapObjectValues')
function qo(e, t) {
  if (e.length === 0) return
  let r = e[0],
    n = t(e[0])
  for (let i = 1; i < e.length; i++) {
    let o = t(e[i])
    o > n && ((n = o), (r = e[i]))
  }
  return r
}
a(qo, 'maxBy')
var cu = new Set(),
  Vo = a((e, t, ...r) => {
    cu.has(e) || (cu.add(e), Lo(t, ...r))
  }, 'warnOnce')
var Hc = require('async_hooks'),
  Yc = require('events'),
  zc = O(require('fs')),
  dn = O(require('path'))
var fu = O(pu())
function du(e) {
  return { ...e, mappings: qm(e.mappings, e.datamodel) }
}
a(du, 'externalToInternalDmmf')
function qm(e, t) {
  return {
    modelOperations: e.modelOperations
      .filter((n) => {
        let i = t.models.find((o) => o.name === n.model)
        if (!i) throw new Error(`Mapping without model ${n.model}`)
        return i.fields.some((o) => o.kind !== 'object')
      })
      .map((n) => ({
        model: n.model,
        plural: (0, fu.default)($t(n.model)),
        findUnique: n.findUnique || n.findSingle,
        findUniqueOrThrow: n.findUniqueOrThrow,
        findFirst: n.findFirst,
        findFirstOrThrow: n.findFirstOrThrow,
        findMany: n.findMany,
        create: n.createOne || n.createSingle || n.create,
        createMany: n.createMany,
        delete: n.deleteOne || n.deleteSingle || n.delete,
        update: n.updateOne || n.updateSingle || n.update,
        deleteMany: n.deleteMany,
        updateMany: n.updateMany,
        upsert: n.upsertOne || n.upsertSingle || n.upsert,
        aggregate: n.aggregate,
        groupBy: n.groupBy,
        findRaw: n.findRaw,
        aggregateRaw: n.aggregateRaw,
      })),
    otherOperations: e.otherOperations,
  }
}
a(qm, 'getMappings')
function mu(e) {
  return du(e)
}
a(mu, 'getPrismaClientDMMF')
var A = O(ae())
var xt = O(fr()),
  Yo = O(Rr())
var Oe = class {
  constructor() {
    this._map = new Map()
  }
  get(t) {
    return this._map.get(t)?.value
  }
  set(t, r) {
    this._map.set(t, { value: r })
  }
  getOrCreate(t, r) {
    let n = this._map.get(t)
    if (n) return n.value
    let i = r()
    return this.set(t, i), i
  }
}
a(Oe, 'Cache')
function Te(e) {
  return e.replace(/^./, (t) => t.toLowerCase())
}
a(Te, 'dmmfToJSModelName')
function hu(e, t, r) {
  let n = Te(r)
  return !t.result || !(t.result.$allModels || t.result[n])
    ? e
    : Vm({
        ...e,
        ...gu(t.name, e, t.result.$allModels),
        ...gu(t.name, e, t.result[n]),
      })
}
a(hu, 'getComputedFields')
function Vm(e) {
  let t = new Oe(),
    r = a(
      (n, i) =>
        t.getOrCreate(n, () =>
          i.has(n)
            ? [n]
            : (i.add(n), e[n] ? e[n].needs.flatMap((o) => r(o, i)) : [n])
        ),
      'resolveNeeds'
    )
  return Zt(e, (n) => ({ ...n, needs: r(n.name, new Set()) }))
}
a(Vm, 'resolveDependencies')
function gu(e, t, r) {
  return r
    ? Zt(r, ({ needs: n, compute: i }, o) => ({
        name: o,
        needs: n ? Object.keys(n).filter((s) => n[s]) : [],
        compute: Um(t, o, i),
      }))
    : {}
}
a(gu, 'getComputedFieldsFromModel')
function Um(e, t, r) {
  let n = e?.[t]?.compute
  return n ? (i) => r({ ...i, [t]: n(i) }) : r
}
a(Um, 'composeCompute')
function ui(e, t) {
  if (!t) return e
  let r = { ...e }
  for (let n of Object.values(t))
    if (!!e[n.name]) for (let i of n.needs) r[i] = !0
  return r
}
a(ui, 'applyComputedFieldsToSelection')
var er = O(ae()),
  Au = O(fr())
var Tu = O(require('fs'))
var ut = O(ae())
var Gm = ut.default.rgb(246, 145, 95),
  Qm = ut.default.rgb(107, 139, 140),
  ci = ut.default.cyan,
  yu = ut.default.rgb(127, 155, 155),
  bu = a((e) => e, 'identity'),
  Eu = {
    keyword: ci,
    entity: ci,
    value: yu,
    punctuation: Qm,
    directive: ci,
    function: ci,
    variable: yu,
    string: ut.default.greenBright,
    boolean: Gm,
    number: ut.default.cyan,
    comment: ut.default.grey,
  }
var pi = {},
  Km = 0,
  R = {
    manual: pi.Prism && pi.Prism.manual,
    disableWorkerMessageHandler:
      pi.Prism && pi.Prism.disableWorkerMessageHandler,
    util: {
      encode: function (e) {
        if (e instanceof Me) {
          let t = e
          return new Me(t.type, R.util.encode(t.content), t.alias)
        } else
          return Array.isArray(e)
            ? e.map(R.util.encode)
            : e
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/\u00a0/g, ' ')
      },
      type: function (e) {
        return Object.prototype.toString.call(e).slice(8, -1)
      },
      objId: function (e) {
        return (
          e.__id || Object.defineProperty(e, '__id', { value: ++Km }), e.__id
        )
      },
      clone: a(function e(t, r) {
        let n,
          i,
          o = R.util.type(t)
        switch (((r = r || {}), o)) {
          case 'Object':
            if (((i = R.util.objId(t)), r[i])) return r[i]
            ;(n = {}), (r[i] = n)
            for (let s in t) t.hasOwnProperty(s) && (n[s] = e(t[s], r))
            return n
          case 'Array':
            return (
              (i = R.util.objId(t)),
              r[i]
                ? r[i]
                : ((n = []),
                  (r[i] = n),
                  t.forEach(function (s, l) {
                    n[l] = e(s, r)
                  }),
                  n)
            )
          default:
            return t
        }
      }, 'deepClone'),
    },
    languages: {
      extend: function (e, t) {
        let r = R.util.clone(R.languages[e])
        for (let n in t) r[n] = t[n]
        return r
      },
      insertBefore: function (e, t, r, n) {
        n = n || R.languages
        let i = n[e],
          o = {}
        for (let l in i)
          if (i.hasOwnProperty(l)) {
            if (l == t) for (let u in r) r.hasOwnProperty(u) && (o[u] = r[u])
            r.hasOwnProperty(l) || (o[l] = i[l])
          }
        let s = n[e]
        return (
          (n[e] = o),
          R.languages.DFS(R.languages, function (l, u) {
            u === s && l != e && (this[l] = o)
          }),
          o
        )
      },
      DFS: a(function e(t, r, n, i) {
        i = i || {}
        let o = R.util.objId
        for (let s in t)
          if (t.hasOwnProperty(s)) {
            r.call(t, s, t[s], n || s)
            let l = t[s],
              u = R.util.type(l)
            u === 'Object' && !i[o(l)]
              ? ((i[o(l)] = !0), e(l, r, null, i))
              : u === 'Array' && !i[o(l)] && ((i[o(l)] = !0), e(l, r, s, i))
          }
      }, 'DFS'),
    },
    plugins: {},
    highlight: function (e, t, r) {
      let n = { code: e, grammar: t, language: r }
      return (
        R.hooks.run('before-tokenize', n),
        (n.tokens = R.tokenize(n.code, n.grammar)),
        R.hooks.run('after-tokenize', n),
        Me.stringify(R.util.encode(n.tokens), n.language)
      )
    },
    matchGrammar: function (e, t, r, n, i, o, s) {
      for (let g in r) {
        if (!r.hasOwnProperty(g) || !r[g]) continue
        if (g == s) return
        let b = r[g]
        b = R.util.type(b) === 'Array' ? b : [b]
        for (let y = 0; y < b.length; ++y) {
          let x = b[y],
            E = x.inside,
            w = !!x.lookbehind,
            T = !!x.greedy,
            C = 0,
            S = x.alias
          if (T && !x.pattern.global) {
            let D = x.pattern.toString().match(/[imuy]*$/)[0]
            x.pattern = RegExp(x.pattern.source, D + 'g')
          }
          x = x.pattern || x
          for (let D = n, q = i; D < t.length; q += t[D].length, ++D) {
            let V = t[D]
            if (t.length > e.length) return
            if (V instanceof Me) continue
            if (T && D != t.length - 1) {
              x.lastIndex = q
              var f = x.exec(e)
              if (!f) break
              var p = f.index + (w ? f[1].length : 0),
                d = f.index + f[0].length,
                l = D,
                u = q
              for (
                let $ = t.length;
                l < $ && (u < d || (!t[l].type && !t[l - 1].greedy));
                ++l
              )
                (u += t[l].length), p >= u && (++D, (q = u))
              if (t[D] instanceof Me) continue
              ;(c = l - D), (V = e.slice(q, u)), (f.index -= q)
            } else {
              x.lastIndex = 0
              var f = x.exec(V),
                c = 1
            }
            if (!f) {
              if (o) break
              continue
            }
            w && (C = f[1] ? f[1].length : 0)
            var p = f.index + C,
              f = f[0].slice(C),
              d = p + f.length,
              m = V.slice(0, p),
              h = V.slice(d)
            let te = [D, c]
            m && (++D, (q += m.length), te.push(m))
            let At = new Me(g, E ? R.tokenize(f, E) : f, S, f, T)
            if (
              (te.push(At),
              h && te.push(h),
              Array.prototype.splice.apply(t, te),
              c != 1 && R.matchGrammar(e, t, r, D, q, !0, g),
              o)
            )
              break
          }
        }
      }
    },
    tokenize: function (e, t) {
      let r = [e],
        n = t.rest
      if (n) {
        for (let i in n) t[i] = n[i]
        delete t.rest
      }
      return R.matchGrammar(e, r, t, 0, 0, !1), r
    },
    hooks: {
      all: {},
      add: function (e, t) {
        let r = R.hooks.all
        ;(r[e] = r[e] || []), r[e].push(t)
      },
      run: function (e, t) {
        let r = R.hooks.all[e]
        if (!(!r || !r.length)) for (var n = 0, i; (i = r[n++]); ) i(t)
      },
    },
    Token: Me,
  }
R.languages.clike = {
  comment: [
    { pattern: /(^|[^\\])\/\*[\s\S]*?(?:\*\/|$)/, lookbehind: !0 },
    { pattern: /(^|[^\\:])\/\/.*/, lookbehind: !0, greedy: !0 },
  ],
  string: {
    pattern: /(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/,
    greedy: !0,
  },
  'class-name': {
    pattern:
      /((?:\b(?:class|interface|extends|implements|trait|instanceof|new)\s+)|(?:catch\s+\())[\w.\\]+/i,
    lookbehind: !0,
    inside: { punctuation: /[.\\]/ },
  },
  keyword:
    /\b(?:if|else|while|do|for|return|in|instanceof|function|new|try|throw|catch|finally|null|break|continue)\b/,
  boolean: /\b(?:true|false)\b/,
  function: /\w+(?=\()/,
  number: /\b0x[\da-f]+\b|(?:\b\d+\.?\d*|\B\.\d+)(?:e[+-]?\d+)?/i,
  operator: /--?|\+\+?|!=?=?|<=?|>=?|==?=?|&&?|\|\|?|\?|\*|\/|~|\^|%/,
  punctuation: /[{}[\];(),.:]/,
}
R.languages.javascript = R.languages.extend('clike', {
  'class-name': [
    R.languages.clike['class-name'],
    {
      pattern:
        /(^|[^$\w\xA0-\uFFFF])[_$A-Z\xA0-\uFFFF][$\w\xA0-\uFFFF]*(?=\.(?:prototype|constructor))/,
      lookbehind: !0,
    },
  ],
  keyword: [
    { pattern: /((?:^|})\s*)(?:catch|finally)\b/, lookbehind: !0 },
    {
      pattern:
        /(^|[^.])\b(?:as|async(?=\s*(?:function\b|\(|[$\w\xA0-\uFFFF]|$))|await|break|case|class|const|continue|debugger|default|delete|do|else|enum|export|extends|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)\b/,
      lookbehind: !0,
    },
  ],
  number:
    /\b(?:(?:0[xX](?:[\dA-Fa-f](?:_[\dA-Fa-f])?)+|0[bB](?:[01](?:_[01])?)+|0[oO](?:[0-7](?:_[0-7])?)+)n?|(?:\d(?:_\d)?)+n|NaN|Infinity)\b|(?:\b(?:\d(?:_\d)?)+\.?(?:\d(?:_\d)?)*|\B\.(?:\d(?:_\d)?)+)(?:[Ee][+-]?(?:\d(?:_\d)?)+)?/,
  function:
    /[_$a-zA-Z\xA0-\uFFFF][$\w\xA0-\uFFFF]*(?=\s*(?:\.\s*(?:apply|bind|call)\s*)?\()/,
  operator:
    /-[-=]?|\+[+=]?|!=?=?|<<?=?|>>?>?=?|=(?:==?|>)?|&[&=]?|\|[|=]?|\*\*?=?|\/=?|~|\^=?|%=?|\?|\.{3}/,
})
R.languages.javascript['class-name'][0].pattern =
  /(\b(?:class|interface|extends|implements|instanceof|new)\s+)[\w.\\]+/
R.languages.insertBefore('javascript', 'keyword', {
  regex: {
    pattern:
      /((?:^|[^$\w\xA0-\uFFFF."'\])\s])\s*)\/(\[(?:[^\]\\\r\n]|\\.)*]|\\.|[^/\\\[\r\n])+\/[gimyus]{0,6}(?=\s*($|[\r\n,.;})\]]))/,
    lookbehind: !0,
    greedy: !0,
  },
  'function-variable': {
    pattern:
      /[_$a-zA-Z\xA0-\uFFFF][$\w\xA0-\uFFFF]*(?=\s*[=:]\s*(?:async\s*)?(?:\bfunction\b|(?:\((?:[^()]|\([^()]*\))*\)|[_$a-zA-Z\xA0-\uFFFF][$\w\xA0-\uFFFF]*)\s*=>))/,
    alias: 'function',
  },
  parameter: [
    {
      pattern:
        /(function(?:\s+[_$A-Za-z\xA0-\uFFFF][$\w\xA0-\uFFFF]*)?\s*\(\s*)(?!\s)(?:[^()]|\([^()]*\))+?(?=\s*\))/,
      lookbehind: !0,
      inside: R.languages.javascript,
    },
    {
      pattern: /[_$a-z\xA0-\uFFFF][$\w\xA0-\uFFFF]*(?=\s*=>)/i,
      inside: R.languages.javascript,
    },
    {
      pattern: /(\(\s*)(?!\s)(?:[^()]|\([^()]*\))+?(?=\s*\)\s*=>)/,
      lookbehind: !0,
      inside: R.languages.javascript,
    },
    {
      pattern:
        /((?:\b|\s|^)(?!(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|null|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|undefined|var|void|while|with|yield)(?![$\w\xA0-\uFFFF]))(?:[_$A-Za-z\xA0-\uFFFF][$\w\xA0-\uFFFF]*\s*)\(\s*)(?!\s)(?:[^()]|\([^()]*\))+?(?=\s*\)\s*\{)/,
      lookbehind: !0,
      inside: R.languages.javascript,
    },
  ],
  constant: /\b[A-Z](?:[A-Z_]|\dx?)*\b/,
})
R.languages.markup && R.languages.markup.tag.addInlined('script', 'javascript')
R.languages.js = R.languages.javascript
R.languages.typescript = R.languages.extend('javascript', {
  keyword:
    /\b(?:abstract|as|async|await|break|case|catch|class|const|constructor|continue|debugger|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|is|keyof|let|module|namespace|new|null|of|package|private|protected|public|readonly|return|require|set|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b/,
  builtin:
    /\b(?:string|Function|any|number|boolean|Array|symbol|console|Promise|unknown|never)\b/,
})
R.languages.ts = R.languages.typescript
function Me(e, t, r, n, i) {
  ;(this.type = e),
    (this.content = t),
    (this.alias = r),
    (this.length = (n || '').length | 0),
    (this.greedy = !!i)
}
a(Me, 'Token')
Me.stringify = function (e, t) {
  return typeof e == 'string'
    ? e
    : Array.isArray(e)
    ? e
        .map(function (r) {
          return Me.stringify(r, t)
        })
        .join('')
    : Wm(e.type)(e.content)
}
function Wm(e) {
  return Eu[e] || bu
}
a(Wm, 'getColorForSyntaxKind')
function wu(e) {
  return Jm(e, R.languages.javascript)
}
a(wu, 'highlightTS')
function Jm(e, t) {
  return R.tokenize(e, t)
    .map((n) => Me.stringify(n))
    .join('')
}
a(Jm, 'highlight')
var xu = O(ko())
function vu(e) {
  return (0, xu.default)(e)
}
a(vu, 'dedent')
var Ae = class {
  static read(t) {
    let r
    try {
      r = Tu.default.readFileSync(t, 'utf-8')
    } catch {
      return null
    }
    return Ae.fromContent(r)
  }
  static fromContent(t) {
    let r = t.split(/\r?\n/)
    return new Ae(1, r)
  }
  constructor(t, r) {
    ;(this.firstLineNumber = t), (this.lines = r)
  }
  get lastLineNumber() {
    return this.firstLineNumber + this.lines.length - 1
  }
  mapLineAt(t, r) {
    if (
      t < this.firstLineNumber ||
      t > this.lines.length + this.firstLineNumber
    )
      return this
    let n = t - this.firstLineNumber,
      i = [...this.lines]
    return (i[n] = r(i[n])), new Ae(this.firstLineNumber, i)
  }
  mapLines(t) {
    return new Ae(
      this.firstLineNumber,
      this.lines.map((r, n) => t(r, this.firstLineNumber + n))
    )
  }
  lineAt(t) {
    return this.lines[t - this.firstLineNumber]
  }
  prependSymbolAt(t, r) {
    return this.mapLines((n, i) => (i === t ? `${r} ${n}` : `  ${n}`))
  }
  slice(t, r) {
    let n = this.lines.slice(t - 1, r).join(`
`)
    return new Ae(
      t,
      vu(n).split(`
`)
    )
  }
  highlight() {
    let t = wu(this.toString())
    return new Ae(
      this.firstLineNumber,
      t.split(`
`)
    )
  }
  toString() {
    return this.lines.join(`
`)
  }
}
a(Ae, 'SourceFileSlice')
var Hm = {
    red: (e) => er.default.red(e),
    gray: (e) => er.default.gray(e),
    dim: (e) => er.default.dim(e),
    bold: (e) => er.default.bold(e),
    underline: (e) => er.default.underline(e),
    highlightSource: (e) => e.highlight(),
  },
  Ym = {
    red: (e) => e,
    gray: (e) => e,
    dim: (e) => e,
    bold: (e) => e,
    underline: (e) => e,
    highlightSource: (e) => e,
  }
function zm(
  { callsite: e, message: t, originalMethod: r, isPanic: n, callArguments: i },
  o
) {
  let s = {
    functionName: `prisma.${r}()`,
    message: t,
    isPanic: n ?? !1,
    callArguments: i,
  }
  if (!e || typeof window < 'u' || process.env.NODE_ENV === 'production')
    return s
  let l = e.getLocation()
  if (!l || !l.lineNumber || !l.columnNumber) return s
  let u = Math.max(1, l.lineNumber - 3),
    c = Ae.read(l.fileName)?.slice(u, l.lineNumber),
    p = c?.lineAt(l.lineNumber)
  if (c && p) {
    let f = Zm(p),
      d = Xm(p)
    if (!d) return s
    ;(s.functionName = `${d.code})`),
      (s.location = l),
      n ||
        (c = c.mapLineAt(l.lineNumber, (h) => h.slice(0, d.openingBraceIndex))),
      (c = o.highlightSource(c))
    let m = String(c.lastLineNumber).length
    if (
      ((s.contextLines = c
        .mapLines((h, g) => o.gray(String(g).padStart(m)) + ' ' + h)
        .mapLines((h) => o.dim(h))
        .prependSymbolAt(l.lineNumber, o.bold(o.red('\u2192')))),
      i)
    ) {
      let h = f + m + 1
      ;(h += 2), (s.callArguments = (0, Au.default)(i, h).slice(h))
    }
  }
  return s
}
a(zm, 'getTemplateParameters')
function Xm(e) {
  let t = Object.keys(Ie.ModelAction).join('|'),
    n = new RegExp(String.raw`\.(${t})\(`).exec(e)
  if (n) {
    let i = n.index + n[0].length,
      o = e.lastIndexOf(' ', n.index) + 1
    return { code: e.slice(o, i), openingBraceIndex: i }
  }
  return null
}
a(Xm, 'findPrismaActionCall')
function Zm(e) {
  let t = 0
  for (let r = 0; r < e.length; r++) {
    if (e.charAt(r) !== ' ') return t
    t++
  }
  return t
}
a(Zm, 'getIndent')
function eg(
  {
    functionName: e,
    location: t,
    message: r,
    isPanic: n,
    contextLines: i,
    callArguments: o,
  },
  s
) {
  let l = [''],
    u = t ? ' in' : ':'
  if (
    (n
      ? (l.push(
          s.red(
            `Oops, an unknown error occurred! This is ${s.bold(
              'on us'
            )}, you did nothing wrong.`
          )
        ),
        l.push(
          s.red(`It occurred in the ${s.bold(`\`${e}\``)} invocation${u}`)
        ))
      : l.push(s.red(`Invalid ${s.bold(`\`${e}\``)} invocation${u}`)),
    t && l.push(s.underline(tg(t))),
    i)
  ) {
    l.push('')
    let c = [i.toString()]
    o && (c.push(o), c.push(s.dim(')'))), l.push(c.join('')), o && l.push('')
  } else l.push(''), o && l.push(o), l.push('')
  return (
    l.push(r),
    l.join(`
`)
  )
}
a(eg, 'stringifyErrorMessage')
function tg(e) {
  let t = [e.fileName]
  return (
    e.lineNumber && t.push(String(e.lineNumber)),
    e.columnNumber && t.push(String(e.columnNumber)),
    t.join(':')
  )
}
a(tg, 'stringifyLocationInFile')
function ct(e) {
  let t = e.showColors ? Hm : Ym,
    r = zm(e, t)
  return eg(r, t)
}
a(ct, 'createErrorMessageWithContext')
function Pu(e) {
  return e instanceof Buffer || e instanceof Date || e instanceof RegExp
}
a(Pu, 'isSpecificValue')
function _u(e) {
  if (e instanceof Buffer) {
    let t = Buffer.alloc ? Buffer.alloc(e.length) : new Buffer(e.length)
    return e.copy(t), t
  } else {
    if (e instanceof Date) return new Date(e.getTime())
    if (e instanceof RegExp) return new RegExp(e)
    throw new Error('Unexpected situation')
  }
}
a(_u, 'cloneSpecificValue')
function Cu(e) {
  let t = []
  return (
    e.forEach(function (r, n) {
      typeof r == 'object' && r !== null
        ? Array.isArray(r)
          ? (t[n] = Cu(r))
          : Pu(r)
          ? (t[n] = _u(r))
          : (t[n] = Hr({}, r))
        : (t[n] = r)
    }),
    t
  )
}
a(Cu, 'deepCloneArray')
function Su(e, t) {
  return t === '__proto__' ? void 0 : e[t]
}
a(Su, 'safeGetProperty')
var Hr = a(function (e, ...t) {
  if (!e || typeof e != 'object') return !1
  if (t.length === 0) return e
  let r, n
  for (let i of t)
    if (!(typeof i != 'object' || i === null || Array.isArray(i))) {
      for (let o of Object.keys(i))
        if (((n = Su(e, o)), (r = Su(i, o)), r !== e))
          if (typeof r != 'object' || r === null) {
            e[o] = r
            continue
          } else if (Array.isArray(r)) {
            e[o] = Cu(r)
            continue
          } else if (Pu(r)) {
            e[o] = _u(r)
            continue
          } else if (typeof n != 'object' || n === null || Array.isArray(n)) {
            e[o] = Hr({}, r)
            continue
          } else {
            e[o] = Hr(n, r)
            continue
          }
    }
  return e
}, 'deepExtend')
var Ou = a((e) => (Array.isArray(e) ? e : e.split('.')), 'keys'),
  Yr = a((e, t) => Ou(t).reduce((r, n) => r && r[n], e), 'deepGet'),
  fi = a(
    (e, t, r) =>
      Ou(t).reduceRight(
        (n, i, o, s) => Object.assign({}, Yr(e, s.slice(0, o)), { [i]: n }),
        r
      ),
    'deepSet'
  )
function Mu(e, t) {
  if (!e || typeof e != 'object' || typeof e.hasOwnProperty != 'function')
    return e
  let r = {}
  for (let n in e) {
    let i = e[n]
    Object.hasOwnProperty.call(e, n) && t(n, i) && (r[n] = i)
  }
  return r
}
a(Mu, 'filterObject')
var rg = {
  '[object Date]': !0,
  '[object Uint8Array]': !0,
  '[object Decimal]': !0,
}
function Nu(e) {
  return e ? typeof e == 'object' && !rg[Object.prototype.toString.call(e)] : !1
}
a(Nu, 'isObject')
function Ru(e, t) {
  let r = {},
    n = Array.isArray(t) ? t : [t]
  for (let i in e)
    Object.hasOwnProperty.call(e, i) && !n.includes(i) && (r[i] = e[i])
  return r
}
a(Ru, 'omit')
var xe = O(ae()),
  Wo = O(Rr())
var ng = Iu(),
  ig = ku(),
  og = $u().default,
  sg = a((e, t, r) => {
    let n = []
    return a(function i(o, s = {}, l = '', u = []) {
      s.indent = s.indent || '	'
      let c
      s.inlineCharacterLimit === void 0
        ? (c = {
            newLine: `
`,
            newLineOrSpace: `
`,
            pad: l,
            indent: l + s.indent,
          })
        : (c = {
            newLine: '@@__STRINGIFY_OBJECT_NEW_LINE__@@',
            newLineOrSpace: '@@__STRINGIFY_OBJECT_NEW_LINE_OR_SPACE__@@',
            pad: '@@__STRINGIFY_OBJECT_PAD__@@',
            indent: '@@__STRINGIFY_OBJECT_INDENT__@@',
          })
      let p = a((f) => {
        if (s.inlineCharacterLimit === void 0) return f
        let d = f
          .replace(new RegExp(c.newLine, 'g'), '')
          .replace(new RegExp(c.newLineOrSpace, 'g'), ' ')
          .replace(new RegExp(c.pad + '|' + c.indent, 'g'), '')
        return d.length <= s.inlineCharacterLimit
          ? d
          : f
              .replace(
                new RegExp(c.newLine + '|' + c.newLineOrSpace, 'g'),
                `
`
              )
              .replace(new RegExp(c.pad, 'g'), l)
              .replace(new RegExp(c.indent, 'g'), l + s.indent)
      }, 'expandWhiteSpace')
      if (n.indexOf(o) !== -1) return '"[Circular]"'
      if (Buffer.isBuffer(o)) return `Buffer(${Buffer.length})`
      if (
        o == null ||
        typeof o == 'number' ||
        typeof o == 'boolean' ||
        typeof o == 'function' ||
        typeof o == 'symbol' ||
        o instanceof Y ||
        ng(o)
      )
        return String(o)
      if (o instanceof Date) return `new Date('${o.toISOString()}')`
      if (o instanceof be) return `prisma.${$t(o.modelName)}.fields.${o.name}`
      if (Array.isArray(o)) {
        if (o.length === 0) return '[]'
        n.push(o)
        let f =
          '[' +
          c.newLine +
          o
            .map((d, m) => {
              let h = o.length - 1 === m ? c.newLine : ',' + c.newLineOrSpace,
                g = i(d, s, l + s.indent, [...u, m])
              return (
                s.transformValue && (g = s.transformValue(o, m, g)),
                c.indent + g + h
              )
            })
            .join('') +
          c.pad +
          ']'
        return n.pop(), p(f)
      }
      if (ig(o)) {
        let f = Object.keys(o).concat(og(o))
        if ((s.filter && (f = f.filter((m) => s.filter(o, m))), f.length === 0))
          return '{}'
        n.push(o)
        let d =
          '{' +
          c.newLine +
          f
            .map((m, h) => {
              let g = f.length - 1 === h ? c.newLine : ',' + c.newLineOrSpace,
                b = typeof m == 'symbol',
                y = !b && /^[a-z$_][a-z$_0-9]*$/i.test(m),
                x = b || y ? m : i(m, s, void 0, [...u, m]),
                E = i(o[m], s, l + s.indent, [...u, m])
              s.transformValue && (E = s.transformValue(o, m, E))
              let w = c.indent + String(x) + ': ' + E + g
              return (
                s.transformLine &&
                  (w = s.transformLine({
                    obj: o,
                    indent: c.indent,
                    key: x,
                    stringifiedValue: E,
                    value: o[m],
                    eol: g,
                    originalLine: w,
                    path: u.concat(x),
                  })),
                w
              )
            })
            .join('') +
          c.pad +
          '}'
        return n.pop(), p(d)
      }
      return (
        (o = String(o).replace(/[\r\n]/g, (f) =>
          f ===
          `
`
            ? '\\n'
            : '\\r'
        )),
        s.singleQuotes === !1
          ? ((o = o.replace(/"/g, '\\"')), `"${o}"`)
          : ((o = o.replace(/\\?'/g, "\\'")), `'${o}'`)
      )
    }, 'stringifyObject')(e, t, r)
  }, 'stringifyObject'),
  zr = sg
var Ko = '@@__DIM_POINTER__@@'
function di({ ast: e, keyPaths: t, valuePaths: r, missingItems: n }) {
  let i = e
  for (let { path: o, type: s } of n) i = fi(i, o, s)
  return zr(i, {
    indent: '  ',
    transformLine: ({
      indent: o,
      key: s,
      value: l,
      stringifiedValue: u,
      eol: c,
      path: p,
    }) => {
      let f = p.join('.'),
        d = t.includes(f),
        m = r.includes(f),
        h = n.find((b) => b.path === f),
        g = u
      if (h) {
        typeof l == 'string' && (g = g.slice(1, g.length - 1))
        let b = h.isRequired ? '' : '?',
          y = h.isRequired ? '+' : '?',
          E = (h.isRequired ? xe.default.greenBright : xe.default.green)(
            ug(s + b + ': ' + g + c, o, y)
          )
        return h.isRequired || (E = xe.default.dim(E)), E
      } else {
        let b = n.some((w) => f.startsWith(w.path)),
          y = s[s.length - 2] === '?'
        y && (s = s.slice(1, s.length - 1)),
          y &&
            typeof l == 'object' &&
            l !== null &&
            (g = g
              .split(
                `
`
              )
              .map((w, T, C) => (T === C.length - 1 ? w + Ko : w)).join(`
`)),
          b &&
            typeof l == 'string' &&
            ((g = g.slice(1, g.length - 1)), y || (g = xe.default.bold(g))),
          (typeof l != 'object' || l === null) &&
            !m &&
            !b &&
            (g = xe.default.dim(g))
        let x = d ? xe.default.redBright(s) : s
        g = m ? xe.default.redBright(g) : g
        let E = o + x + ': ' + g + (b ? c : xe.default.dim(c))
        if (d || m) {
          let w = E.split(`
`),
            T = String(s).length,
            C = d ? xe.default.redBright('~'.repeat(T)) : ' '.repeat(T),
            S = m ? ag(o, s, l, u) : 0,
            D = m && Lu(l),
            q = m ? '  ' + xe.default.redBright('~'.repeat(S)) : ''
          C && C.length > 0 && !D && w.splice(1, 0, o + C + q),
            C &&
              C.length > 0 &&
              D &&
              w.splice(w.length - 1, 0, o.slice(0, o.length - 2) + q),
            (E = w.join(`
`))
        }
        return E
      }
    },
  })
}
a(di, 'printJsonWithErrors')
function ag(e, t, r, n) {
  return r === null
    ? 4
    : typeof r == 'string'
    ? r.length + 2
    : Lu(r)
    ? Math.abs(lg(`${t}: ${(0, Wo.default)(n)}`) - e.length)
    : String(r).length
}
a(ag, 'getValueLength')
function Lu(e) {
  return typeof e == 'object' && e !== null && !(e instanceof Y)
}
a(Lu, 'isRenderedAsObject')
function lg(e) {
  return e
    .split(
      `
`
    )
    .reduce((t, r) => (r.length > t ? r.length : t), 0)
}
a(lg, 'getLongestLine')
function ug(e, t, r) {
  return e
    .split(
      `
`
    )
    .map((n, i, o) =>
      i === 0 ? r + t.slice(1) + n : i < o.length - 1 ? r + n.slice(1) : n
    )
    .map((n) =>
      (0, Wo.default)(n).includes(Ko)
        ? xe.default.dim(n.replace(Ko, ''))
        : n.includes('?')
        ? xe.default.dim(n)
        : n
    ).join(`
`)
}
a(ug, 'prefixLines')
var Xr = 2,
  mi = class {
    constructor(t, r) {
      this.type = t
      this.children = r
      this.printFieldError = a(({ error: t }, r, n) => {
        if (t.type === 'emptySelect') {
          let i = n
            ? ''
            : ` Available options are listed in ${A.default.greenBright.dim(
                'green'
              )}.`
          return `The ${A.default.redBright(
            '`select`'
          )} statement for type ${A.default.bold(
            br(t.field.outputType.type)
          )} must not be empty.${i}`
        }
        if (t.type === 'emptyInclude') {
          if (r.length === 0)
            return `${A.default.bold(
              br(t.field.outputType.type)
            )} does not have any relation and therefore can't have an ${A.default.redBright(
              '`include`'
            )} statement.`
          let i = n
            ? ''
            : ` Available options are listed in ${A.default.greenBright.dim(
                'green'
              )}.`
          return `The ${A.default.redBright(
            '`include`'
          )} statement for type ${A.default.bold(
            br(t.field.outputType.type)
          )} must not be empty.${i}`
        }
        if (t.type === 'noTrueSelect')
          return `The ${A.default.redBright(
            '`select`'
          )} statement for type ${A.default.bold(
            br(t.field.outputType.type)
          )} needs ${A.default.bold('at least one truthy value')}.`
        if (t.type === 'includeAndSelect')
          return `Please ${A.default.bold(
            'either'
          )} use ${A.default.greenBright(
            '`include`'
          )} or ${A.default.greenBright('`select`')}, but ${A.default.redBright(
            'not both'
          )} at the same time.`
        if (t.type === 'invalidFieldName') {
          let i = t.isInclude ? 'include' : 'select',
            o = t.isIncludeScalar ? 'Invalid scalar' : 'Unknown',
            s = n
              ? ''
              : t.isInclude && r.length === 0
              ? `
This model has no relations, so you can't use ${A.default.redBright(
                  'include'
                )} with it.`
              : ` Available options are listed in ${A.default.greenBright.dim(
                  'green'
                )}.`,
            l = `${o} field ${A.default.redBright(
              `\`${t.providedName}\``
            )} for ${A.default.bold(
              i
            )} statement on model ${A.default.bold.white(t.modelName)}.${s}`
          return (
            t.didYouMean &&
              (l += ` Did you mean ${A.default.greenBright(
                `\`${t.didYouMean}\``
              )}?`),
            t.isIncludeScalar &&
              (l += `
Note, that ${A.default.bold(
                'include'
              )} statements only accept relation fields.`),
            l
          )
        }
        if (t.type === 'invalidFieldType')
          return `Invalid value ${A.default.redBright(
            `${zr(t.providedValue)}`
          )} of type ${A.default.redBright(
            Dt(t.providedValue, void 0)
          )} for field ${A.default.bold(
            `${t.fieldName}`
          )} on model ${A.default.bold.white(
            t.modelName
          )}. Expected either ${A.default.greenBright(
            'true'
          )} or ${A.default.greenBright('false')}.`
      }, 'printFieldError')
      this.printArgError = a(({ error: t, path: r, id: n }, i, o) => {
        if (t.type === 'invalidName') {
          let s = `Unknown arg ${A.default.redBright(
            `\`${t.providedName}\``
          )} in ${A.default.bold(r.join('.'))} for type ${A.default.bold(
            t.outputType ? t.outputType.name : hr(t.originalType)
          )}.`
          return (
            t.didYouMeanField
              ? (s += `
\u2192 Did you forget to wrap it with \`${A.default.greenBright(
                  'select'
                )}\`? ${A.default.dim(
                  'e.g. ' +
                    A.default.greenBright(
                      `{ select: { ${t.providedName}: ${t.providedValue} } }`
                    )
                )}`)
              : t.didYouMeanArg
              ? ((s += ` Did you mean \`${A.default.greenBright(
                  t.didYouMeanArg
                )}\`?`),
                !i &&
                  !o &&
                  (s +=
                    ` ${A.default.dim('Available args:')}
` + kt(t.originalType, !0)))
              : t.originalType.fields.length === 0
              ? (s += ` The field ${A.default.bold(
                  t.originalType.name
                )} has no arguments.`)
              : !i &&
                !o &&
                (s +=
                  ` Available args:

` + kt(t.originalType, !0)),
            s
          )
        }
        if (t.type === 'invalidType') {
          let s = zr(t.providedValue, { indent: '  ' }),
            l =
              s.split(`
`).length > 1
          if (
            (l &&
              (s = `
${s}
`),
            t.requiredType.bestFittingType.location === 'enumTypes')
          )
            return `Argument ${A.default.bold(
              t.argName
            )}: Provided value ${A.default.redBright(s)}${
              l ? '' : ' '
            }of type ${A.default.redBright(
              Dt(t.providedValue)
            )} on ${A.default.bold(
              `prisma.${this.children[0].name}`
            )} is not a ${A.default.greenBright(
              yr(
                It(t.requiredType.bestFittingType.type),
                t.requiredType.bestFittingType.isList
              )
            )}.
\u2192 Possible values: ${t.requiredType.bestFittingType.type.values
              .map((f) =>
                A.default.greenBright(
                  `${It(t.requiredType.bestFittingType.type)}.${f}`
                )
              )
              .join(', ')}`
          let u = '.'
          tr(t.requiredType.bestFittingType.type) &&
            (u =
              `:
` + kt(t.requiredType.bestFittingType.type))
          let c = `${t.requiredType.inputType
              .map((f) =>
                A.default.greenBright(
                  yr(It(f.type), t.requiredType.bestFittingType.isList)
                )
              )
              .join(' or ')}${u}`,
            p =
              (t.requiredType.inputType.length === 2 &&
                t.requiredType.inputType.find((f) => tr(f.type))) ||
              null
          return (
            p &&
              (c +=
                `
` + kt(p.type, !0)),
            `Argument ${A.default.bold(
              t.argName
            )}: Got invalid value ${A.default.redBright(s)}${
              l ? '' : ' '
            }on ${A.default.bold(
              `prisma.${this.children[0].name}`
            )}. Provided ${A.default.redBright(
              Dt(t.providedValue)
            )}, expected ${c}`
          )
        }
        if (t.type === 'invalidNullArg') {
          let s =
              r.length === 1 && r[0] === t.name
                ? ''
                : ` for ${A.default.bold(`${r.join('.')}`)}`,
            l = ` Please use ${A.default.bold.greenBright(
              'undefined'
            )} instead.`
          return `Argument ${A.default.greenBright(
            t.name
          )}${s} must not be ${A.default.bold('null')}.${l}`
        }
        if (t.type === 'missingArg') {
          let s =
            r.length === 1 && r[0] === t.missingName
              ? ''
              : ` for ${A.default.bold(`${r.join('.')}`)}`
          return `Argument ${A.default.greenBright(
            t.missingName
          )}${s} is missing.`
        }
        if (t.type === 'atLeastOne') {
          let s = o
              ? ''
              : ` Available args are listed in ${A.default.dim.green(
                  'green'
                )}.`,
            l = t.atLeastFields
              ? ` and at least one argument for ${t.atLeastFields
                  .map((u) => A.default.bold(u))
                  .join(', or ')}`
              : ''
          return `Argument ${A.default.bold(
            r.join('.')
          )} of type ${A.default.bold(
            t.inputType.name
          )} needs ${A.default.greenBright(
            'at least one'
          )} argument${A.default.bold(l)}.${s}`
        }
        if (t.type === 'atMostOne') {
          let s = o
            ? ''
            : ` Please choose one. ${A.default.dim('Available args:')} 
${kt(t.inputType, !0)}`
          return `Argument ${A.default.bold(
            r.join('.')
          )} of type ${A.default.bold(
            t.inputType.name
          )} needs ${A.default.greenBright(
            'exactly one'
          )} argument, but you provided ${t.providedKeys
            .map((l) => A.default.redBright(l))
            .join(' and ')}.${s}`
        }
      }, 'printArgError')
      ;(this.type = t), (this.children = r)
    }
    get [Symbol.toStringTag]() {
      return 'Document'
    }
    toString() {
      return `${this.type} {
${(0, xt.default)(
  this.children.map(String).join(`
`),
  Xr
)}
}`
    }
    validate(t, r = !1, n, i, o) {
      t || (t = {})
      let s = this.children.filter((y) => y.hasInvalidChild || y.hasInvalidArg)
      if (s.length === 0) return
      let l = [],
        u = [],
        c = t && t.select ? 'select' : t.include ? 'include' : void 0
      for (let y of s) {
        let x = y.collectErrors(c)
        l.push(
          ...x.fieldErrors.map((E) => ({
            ...E,
            path: r ? E.path : E.path.slice(1),
          }))
        ),
          u.push(
            ...x.argErrors.map((E) => ({
              ...E,
              path: r ? E.path : E.path.slice(1),
            }))
          )
      }
      let p = this.children[0].name,
        f = r ? this.type : p,
        d = [],
        m = [],
        h = []
      for (let y of l) {
        let x = this.normalizePath(y.path, t).join('.')
        if (y.error.type === 'invalidFieldName') {
          d.push(x)
          let E = y.error.outputType,
            { isInclude: w } = y.error
          E.fields
            .filter((T) =>
              w ? T.outputType.location === 'outputObjectTypes' : !0
            )
            .forEach((T) => {
              let C = x.split('.')
              h.push({
                path: `${C.slice(0, C.length - 1).join('.')}.${T.name}`,
                type: 'true',
                isRequired: !1,
              })
            })
        } else
          y.error.type === 'includeAndSelect'
            ? (d.push('select'), d.push('include'))
            : m.push(x)
        if (
          y.error.type === 'emptySelect' ||
          y.error.type === 'noTrueSelect' ||
          y.error.type === 'emptyInclude'
        ) {
          let E = this.normalizePath(y.path, t),
            w = E.slice(0, E.length - 1).join('.')
          y.error.field.outputType.type.fields
            ?.filter((C) =>
              y.error.type === 'emptyInclude'
                ? C.outputType.location === 'outputObjectTypes'
                : !0
            )
            .forEach((C) => {
              h.push({ path: `${w}.${C.name}`, type: 'true', isRequired: !1 })
            })
        }
      }
      for (let y of u) {
        let x = this.normalizePath(y.path, t).join('.')
        if (y.error.type === 'invalidName') d.push(x)
        else if (y.error.type !== 'missingArg' && y.error.type !== 'atLeastOne')
          m.push(x)
        else if (y.error.type === 'missingArg') {
          let E =
            y.error.missingArg.inputTypes.length === 1
              ? y.error.missingArg.inputTypes[0].type
              : y.error.missingArg.inputTypes
                  .map((w) => {
                    let T = hr(w.type)
                    return T === 'Null' ? 'null' : w.isList ? T + '[]' : T
                  })
                  .join(' | ')
          h.push({
            path: x,
            type: no(E, !0, x.split('where.').length === 2),
            isRequired: y.error.missingArg.isRequired,
          })
        }
      }
      let g = a((y) => {
          let x = u.some(
              (V) =>
                V.error.type === 'missingArg' && V.error.missingArg.isRequired
            ),
            E = Boolean(
              u.find(
                (V) =>
                  V.error.type === 'missingArg' &&
                  !V.error.missingArg.isRequired
              )
            ),
            w = E || x,
            T = ''
          x &&
            (T += `
${A.default.dim('Note: Lines with ')}${A.default.reset.greenBright(
              '+'
            )} ${A.default.dim('are required')}`),
            E &&
              (T.length === 0 &&
                (T = `
`),
              x
                ? (T += A.default.dim(
                    `, lines with ${A.default.green('?')} are optional`
                  ))
                : (T += A.default.dim(
                    `Note: Lines with ${A.default.green('?')} are optional`
                  )),
              (T += A.default.dim('.')))
          let S = u
            .filter(
              (V) =>
                V.error.type !== 'missingArg' || V.error.missingArg.isRequired
            )
            .map((V) => this.printArgError(V, w, i === 'minimal')).join(`
`)
          if (
            ((S += `
${l.map((V) => this.printFieldError(V, h, i === 'minimal')).join(`
`)}`),
            i === 'minimal')
          )
            return (0, Yo.default)(S)
          let D = {
            ast: r ? { [p]: t } : t,
            keyPaths: d,
            valuePaths: m,
            missingItems: h,
          }
          n?.endsWith('aggregate') && (D = bg(D))
          let q = ct({
            callsite: y,
            originalMethod: n || f,
            showColors: i && i === 'pretty',
            callArguments: di(D),
            message: `${S}${T}
`,
          })
          return process.env.NO_COLOR || i === 'colorless'
            ? (0, Yo.default)(q)
            : q
        }, 'renderErrorStr'),
        b = new J(g(o))
      throw (
        (process.env.NODE_ENV !== 'production' &&
          Object.defineProperty(b, 'render', { get: () => g, enumerable: !1 }),
        b)
      )
    }
    normalizePath(t, r) {
      let n = t.slice(),
        i = [],
        o,
        s = r
      for (; (o = n.shift()) !== void 0; )
        (!Array.isArray(s) && o === 0) ||
          (o === 'select'
            ? s[o]
              ? (s = s[o])
              : (s = s.include)
            : s && s[o] && (s = s[o]),
          i.push(o))
      return i
    }
  }
a(mi, 'Document')
var J = class extends Error {
  get [Symbol.toStringTag]() {
    return 'PrismaClientValidationError'
  }
}
a(J, 'PrismaClientValidationError')
var K = class extends Error {
  constructor(t) {
    super(
      t +
        `
Read more at https://pris.ly/d/client-constructor`
    )
  }
  get [Symbol.toStringTag]() {
    return 'PrismaClientConstructorValidationError'
  }
}
a(K, 'PrismaClientConstructorValidationError')
var oe = class {
  constructor({ name: t, args: r, children: n, error: i, schemaField: o }) {
    ;(this.name = t),
      (this.args = r),
      (this.children = n),
      (this.error = i),
      (this.schemaField = o),
      (this.hasInvalidChild = n
        ? n.some((s) =>
            Boolean(s.error || s.hasInvalidArg || s.hasInvalidChild)
          )
        : !1),
      (this.hasInvalidArg = r ? r.hasInvalidArg : !1)
  }
  get [Symbol.toStringTag]() {
    return 'Field'
  }
  toString() {
    let t = this.name
    return this.error
      ? t + ' # INVALID_FIELD'
      : (this.args &&
          this.args.args &&
          this.args.args.length > 0 &&
          (this.args.args.length === 1
            ? (t += `(${this.args.toString()})`)
            : (t += `(
${(0, xt.default)(this.args.toString(), Xr)}
)`)),
        this.children &&
          (t += ` {
${(0, xt.default)(
  this.children.map(String).join(`
`),
  Xr
)}
}`),
        t)
  }
  collectErrors(t = 'select') {
    let r = [],
      n = []
    if (
      (this.error && r.push({ path: [this.name], error: this.error }),
      this.children)
    )
      for (let i of this.children) {
        let o = i.collectErrors(t)
        r.push(
          ...o.fieldErrors.map((s) => ({
            ...s,
            path: [this.name, t, ...s.path],
          }))
        ),
          n.push(
            ...o.argErrors.map((s) => ({
              ...s,
              path: [this.name, t, ...s.path],
            }))
          )
      }
    return (
      this.args &&
        n.push(
          ...this.args
            .collectErrors()
            .map((i) => ({ ...i, path: [this.name, ...i.path] }))
        ),
      { fieldErrors: r, argErrors: n }
    )
  }
}
a(oe, 'Field')
var se = class {
  constructor(t = []) {
    ;(this.args = t),
      (this.hasInvalidArg = t ? t.some((r) => Boolean(r.hasError)) : !1)
  }
  get [Symbol.toStringTag]() {
    return 'Args'
  }
  toString() {
    return this.args.length === 0
      ? ''
      : `${this.args.map((t) => t.toString()).filter((t) => t).join(`
`)}`
  }
  collectErrors() {
    return this.hasInvalidArg ? this.args.flatMap((t) => t.collectErrors()) : []
  }
}
a(se, 'Args')
function Jo(e, t) {
  return Buffer.isBuffer(e)
    ? JSON.stringify(e.toString('base64'))
    : e instanceof be
    ? `{ _ref: ${JSON.stringify(e.name)}}`
    : Object.prototype.toString.call(e) === '[object BigInt]'
    ? e.toString()
    : typeof t?.type == 'string' && t.type === 'Json'
    ? e === null
      ? 'null'
      : e && e.values && e.__prismaRawParameters__
      ? JSON.stringify(e.values)
      : t?.isList && Array.isArray(e)
      ? JSON.stringify(e.map((r) => JSON.stringify(r)))
      : JSON.stringify(JSON.stringify(e))
    : e === void 0
    ? null
    : e === null
    ? 'null'
    : ye.isDecimal(e) || (t?.type === 'Decimal' && Xe(e))
    ? JSON.stringify(e.toFixed())
    : t?.location === 'enumTypes' && typeof e == 'string'
    ? Array.isArray(e)
      ? `[${e.join(', ')}]`
      : e
    : typeof e == 'number' && t?.type === 'Float'
    ? e.toExponential()
    : JSON.stringify(e, null, 2)
}
a(Jo, 'stringify')
var Se = class {
  constructor({
    key: t,
    value: r,
    isEnum: n = !1,
    error: i,
    schemaArg: o,
    inputType: s,
  }) {
    ;(this.inputType = s),
      (this.key = t),
      (this.value = r instanceof Y ? r._getName() : r),
      (this.isEnum = n),
      (this.error = i),
      (this.schemaArg = o),
      (this.isNullable =
        o?.inputTypes.reduce((l) => l && o.isNullable, !0) || !1),
      (this.hasError =
        Boolean(i) ||
        (r instanceof se ? r.hasInvalidArg : !1) ||
        (Array.isArray(r) &&
          r.some((l) => (l instanceof se ? l.hasInvalidArg : !1))))
  }
  get [Symbol.toStringTag]() {
    return 'Arg'
  }
  _toString(t, r) {
    if (!(typeof t > 'u')) {
      if (t instanceof se)
        return `${r}: {
${(0, xt.default)(t.toString(), 2)}
}`
      if (Array.isArray(t)) {
        if (this.inputType?.type === 'Json')
          return `${r}: ${Jo(t, this.inputType)}`
        let n = !t.some((i) => typeof i == 'object')
        return `${r}: [${
          n
            ? ''
            : `
`
        }${(0, xt.default)(
          t
            .map((i) =>
              i instanceof se
                ? `{
${(0, xt.default)(i.toString(), Xr)}
}`
                : Jo(i, this.inputType)
            )
            .join(
              `,${
                n
                  ? ' '
                  : `
`
              }`
            ),
          n ? 0 : Xr
        )}${
          n
            ? ''
            : `
`
        }]`
      }
      return `${r}: ${Jo(t, this.inputType)}`
    }
  }
  toString() {
    return this._toString(this.value, this.key)
  }
  collectErrors() {
    if (!this.hasError) return []
    let t = []
    if (this.error) {
      let r =
        typeof this.inputType?.type == 'object'
          ? `${this.inputType.type.name}${this.inputType.isList ? '[]' : ''}`
          : void 0
      t.push({ error: this.error, path: [this.key], id: r })
    }
    return Array.isArray(this.value)
      ? t.concat(
          this.value.flatMap((r, n) =>
            r?.collectErrors
              ? r
                  .collectErrors()
                  .map((i) => ({ ...i, path: [this.key, n, ...i.path] }))
              : []
          )
        )
      : this.value instanceof se
      ? t.concat(
          this.value
            .collectErrors()
            .map((r) => ({ ...r, path: [this.key, ...r.path] }))
        )
      : t
  }
}
a(Se, 'Arg')
function yi({
  dmmf: e,
  rootTypeName: t,
  rootField: r,
  select: n,
  modelName: i,
  extensions: o,
}) {
  n || (n = {})
  let s = t === 'query' ? e.queryType : e.mutationType,
    l = {
      args: [],
      outputType: { isList: !1, type: s, location: 'outputObjectTypes' },
      name: t,
    },
    u = { modelName: i },
    c = qu({
      dmmf: e,
      selection: { [r]: n },
      schemaField: l,
      path: [t],
      context: u,
      extensions: o,
    })
  return new mi(t, c)
}
a(yi, 'makeDocument')
function Bu(e) {
  return e
}
a(Bu, 'transformDocument')
function qu({
  dmmf: e,
  selection: t,
  schemaField: r,
  path: n,
  context: i,
  extensions: o,
}) {
  let s = r.outputType.type,
    l = i.modelName ? o.getAllComputedFields(i.modelName) : {}
  return (
    (t = ui(t, l)),
    Object.entries(t).reduce((u, [c, p]) => {
      let f = s.fieldMap ? s.fieldMap[c] : s.fields.find((E) => E.name === c)
      if (!f)
        return (
          l?.[c] ||
            u.push(
              new oe({
                name: c,
                children: [],
                error: {
                  type: 'invalidFieldName',
                  modelName: s.name,
                  providedName: c,
                  didYouMean: Dn(
                    c,
                    s.fields.map((E) => E.name).concat(Object.keys(l ?? {}))
                  ),
                  outputType: s,
                },
              })
            ),
          u
        )
      if (
        f.outputType.location === 'scalar' &&
        f.args.length === 0 &&
        typeof p != 'boolean'
      )
        return (
          u.push(
            new oe({
              name: c,
              children: [],
              error: {
                type: 'invalidFieldType',
                modelName: s.name,
                fieldName: c,
                providedValue: p,
              },
            })
          ),
          u
        )
      if (p === !1) return u
      let d = {
          name: f.name,
          fields: f.args,
          constraints: { minNumFields: null, maxNumFields: null },
        },
        m = typeof p == 'object' ? Ru(p, ['include', 'select']) : void 0,
        h = m
          ? hi(m, d, i, [], typeof f == 'string' ? void 0 : f.outputType.type)
          : void 0,
        g = f.outputType.location === 'outputObjectTypes'
      if (p) {
        if (p.select && p.include)
          u.push(
            new oe({
              name: c,
              children: [
                new oe({
                  name: 'include',
                  args: new se(),
                  error: { type: 'includeAndSelect', field: f },
                }),
              ],
            })
          )
        else if (p.include) {
          let E = Object.keys(p.include)
          if (E.length === 0)
            return (
              u.push(
                new oe({
                  name: c,
                  children: [
                    new oe({
                      name: 'include',
                      args: new se(),
                      error: { type: 'emptyInclude', field: f },
                    }),
                  ],
                })
              ),
              u
            )
          if (f.outputType.location === 'outputObjectTypes') {
            let w = f.outputType.type,
              T = w.fields
                .filter((S) => S.outputType.location === 'outputObjectTypes')
                .map((S) => S.name),
              C = E.filter((S) => !T.includes(S))
            if (C.length > 0)
              return (
                u.push(
                  ...C.map(
                    (S) =>
                      new oe({
                        name: S,
                        children: [
                          new oe({
                            name: S,
                            args: new se(),
                            error: {
                              type: 'invalidFieldName',
                              modelName: w.name,
                              outputType: w,
                              providedName: S,
                              didYouMean: Dn(S, T) || void 0,
                              isInclude: !0,
                              isIncludeScalar: w.fields.some(
                                (D) => D.name === S
                              ),
                            },
                          }),
                        ],
                      })
                  )
                ),
                u
              )
          }
        } else if (p.select) {
          let E = Object.values(p.select)
          if (E.length === 0)
            return (
              u.push(
                new oe({
                  name: c,
                  children: [
                    new oe({
                      name: 'select',
                      args: new se(),
                      error: { type: 'emptySelect', field: f },
                    }),
                  ],
                })
              ),
              u
            )
          if (E.filter((T) => T).length === 0)
            return (
              u.push(
                new oe({
                  name: c,
                  children: [
                    new oe({
                      name: 'select',
                      args: new se(),
                      error: { type: 'noTrueSelect', field: f },
                    }),
                  ],
                })
              ),
              u
            )
        }
      }
      let b = g ? pg(e, f.outputType.type) : null,
        y = b
      p &&
        (p.select
          ? (y = p.select)
          : p.include
          ? (y = Hr(b, p.include))
          : p.by &&
            Array.isArray(p.by) &&
            f.outputType.namespace === 'prisma' &&
            f.outputType.location === 'outputObjectTypes' &&
            ha(f.outputType.type.name) &&
            (y = cg(p.by)))
      let x
      if (y !== !1 && g) {
        let E = i.modelName
        typeof f.outputType.type == 'object' &&
          f.outputType.namespace === 'model' &&
          f.outputType.location === 'outputObjectTypes' &&
          (E = f.outputType.type.name),
          (x = qu({
            dmmf: e,
            selection: y,
            schemaField: f,
            path: [...n, c],
            context: { modelName: E },
            extensions: o,
          }))
      }
      return (
        u.push(new oe({ name: c, args: h, children: x, schemaField: f })), u
      )
    }, [])
  )
}
a(qu, 'selectionToFields')
function cg(e) {
  let t = Object.create(null)
  for (let r of e) t[r] = !0
  return t
}
a(cg, 'byToSelect')
function pg(e, t) {
  let r = Object.create(null)
  for (let n of t.fields)
    e.typeMap[n.outputType.type.name] !== void 0 && (r[n.name] = !0),
      (n.outputType.location === 'scalar' ||
        n.outputType.location === 'enumTypes') &&
        (r[n.name] = !0)
  return r
}
a(pg, 'getDefaultSelection')
function zo(e, t, r, n) {
  return new Se({
    key: e,
    value: t,
    isEnum: n.location === 'enumTypes',
    inputType: n,
    error: {
      type: 'invalidType',
      providedValue: t,
      argName: e,
      requiredType: { inputType: r.inputTypes, bestFittingType: n },
    },
  })
}
a(zo, 'getInvalidTypeArg')
function Vu(e, t, r) {
  let { isList: n } = t,
    i = fg(t, r),
    o = Dt(e, t)
  return o === i ||
    (n && o === 'List<>') ||
    (i === 'Json' &&
      o !== 'Symbol' &&
      !(e instanceof Y) &&
      !(e instanceof be)) ||
    (o === 'Int' && i === 'BigInt') ||
    ((o === 'Int' || o === 'Float') && i === 'Decimal') ||
    (o === 'DateTime' && i === 'String') ||
    (o === 'UUID' && i === 'String') ||
    (o === 'String' && i === 'ID') ||
    (o === 'Int' && i === 'Float') ||
    (o === 'Int' && i === 'Long') ||
    (o === 'String' && i === 'Decimal' && dg(e)) ||
    e === null
    ? !0
    : t.isList && Array.isArray(e)
    ? e.every((s) => Vu(s, { ...t, isList: !1 }, r))
    : !1
}
a(Vu, 'hasCorrectScalarType')
function fg(e, t, r = e.isList) {
  let n = It(e.type)
  return (
    e.location === 'fieldRefTypes' && t.modelName && (n += `<${t.modelName}>`),
    yr(n, r)
  )
}
a(fg, 'getExpectedType')
var gi = a((e) => Mu(e, (t, r) => r !== void 0), 'cleanObject')
function dg(e) {
  return /^\-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(e)
}
a(dg, 'isDecimalString')
function mg(e, t, r, n) {
  let i = null,
    o = []
  for (let s of r.inputTypes) {
    if (((i = hg(e, t, r, s, n)), i?.collectErrors().length === 0)) return i
    if (i && i?.collectErrors()) {
      let l = i?.collectErrors()
      l && l.length > 0 && o.push({ arg: i, errors: l })
    }
  }
  if (i?.hasError && o.length > 0) {
    let s = o.map(({ arg: l, errors: u }) => {
      let c = u.map((p) => {
        let f = 1
        return (
          p.error.type === 'invalidType' &&
            (f = 2 * Math.exp(Uu(p.error.providedValue)) + 1),
          (f += Math.log(p.path.length)),
          p.error.type === 'missingArg' &&
            l.inputType &&
            tr(l.inputType.type) &&
            l.inputType.type.name.includes('Unchecked') &&
            (f *= 2),
          p.error.type === 'invalidName' &&
            tr(p.error.originalType) &&
            p.error.originalType.name.includes('Unchecked') &&
            (f *= 2),
          f
        )
      })
      return { score: u.length + gg(c), arg: l, errors: u }
    })
    return s.sort((l, u) => (l.score < u.score ? -1 : 1)), s[0].arg
  }
  return i
}
a(mg, 'valueToArg')
function Uu(e) {
  let t = 1
  if (!e || typeof e != 'object') return t
  for (let r in e)
    if (
      !!Object.prototype.hasOwnProperty.call(e, r) &&
      typeof e[r] == 'object'
    ) {
      let n = Uu(e[r]) + 1
      t = Math.max(n, t)
    }
  return t
}
a(Uu, 'getDepth')
function gg(e) {
  return e.reduce((t, r) => t + r, 0)
}
a(gg, 'sum')
function hg(e, t, r, n, i) {
  if (typeof t > 'u')
    return r.isRequired
      ? new Se({
          key: e,
          value: t,
          isEnum: n.location === 'enumTypes',
          inputType: n,
          error: {
            type: 'missingArg',
            missingName: e,
            missingArg: r,
            atLeastOne: !1,
            atMostOne: !1,
          },
        })
      : null
  let { isNullable: o, isRequired: s } = r
  if (
    t === null &&
    !o &&
    !s &&
    !(tr(n.type)
      ? n.type.constraints.minNumFields !== null &&
        n.type.constraints.minNumFields > 0
      : !1)
  )
    return new Se({
      key: e,
      value: t,
      isEnum: n.location === 'enumTypes',
      inputType: n,
      error: {
        type: 'invalidNullArg',
        name: e,
        invalidType: r.inputTypes,
        atLeastOne: !1,
        atMostOne: !1,
      },
    })
  if (!n.isList)
    if (tr(n.type)) {
      if (
        typeof t != 'object' ||
        Array.isArray(t) ||
        (n.location === 'inputObjectTypes' && !Nu(t))
      )
        return zo(e, t, r, n)
      {
        let p = gi(t),
          f,
          d = Object.keys(p || {}),
          m = d.length
        return (
          (m === 0 &&
            typeof n.type.constraints.minNumFields == 'number' &&
            n.type.constraints.minNumFields > 0) ||
          n.type.constraints.fields?.some((h) => d.includes(h)) === !1
            ? (f = {
                type: 'atLeastOne',
                key: e,
                inputType: n.type,
                atLeastFields: n.type.constraints.fields,
              })
            : m > 1 &&
              typeof n.type.constraints.maxNumFields == 'number' &&
              n.type.constraints.maxNumFields < 2 &&
              (f = {
                type: 'atMostOne',
                key: e,
                inputType: n.type,
                providedKeys: d,
              }),
          new Se({
            key: e,
            value: p === null ? null : hi(p, n.type, i, r.inputTypes),
            isEnum: n.location === 'enumTypes',
            error: f,
            inputType: n,
            schemaArg: r,
          })
        )
      }
    } else return ju(e, t, r, n, i)
  if (
    (!Array.isArray(t) && n.isList && e !== 'updateMany' && (t = [t]),
    n.location === 'enumTypes' || n.location === 'scalar')
  )
    return ju(e, t, r, n, i)
  let l = n.type,
    c = (
      typeof l.constraints?.minNumFields == 'number' &&
      l.constraints?.minNumFields > 0
        ? Array.isArray(t) &&
          t.some((p) => !p || Object.keys(gi(p)).length === 0)
        : !1
    )
      ? { inputType: l, key: e, type: 'atLeastOne' }
      : void 0
  if (!c) {
    let p =
      typeof l.constraints?.maxNumFields == 'number' &&
      l.constraints?.maxNumFields < 2
        ? Array.isArray(t) &&
          t.find((f) => !f || Object.keys(gi(f)).length !== 1)
        : !1
    p &&
      (c = {
        inputType: l,
        key: e,
        type: 'atMostOne',
        providedKeys: Object.keys(p),
      })
  }
  if (!Array.isArray(t))
    for (let p of r.inputTypes) {
      let f = hi(t, p.type, i)
      if (f.collectErrors().length === 0)
        return new Se({
          key: e,
          value: f,
          isEnum: !1,
          schemaArg: r,
          inputType: p,
        })
    }
  return new Se({
    key: e,
    value: t.map((p) =>
      n.isList && typeof p != 'object'
        ? p
        : typeof p != 'object' || !t
        ? zo(e, p, r, n)
        : hi(p, l, i)
    ),
    isEnum: !1,
    inputType: n,
    schemaArg: r,
    error: c,
  })
}
a(hg, 'tryInferArgs')
function tr(e) {
  return !(typeof e == 'string' || Object.hasOwnProperty.call(e, 'values'))
}
a(tr, 'isInputArgType')
function ju(e, t, r, n, i) {
  return Vu(t, n, i)
    ? new Se({
        key: e,
        value: t,
        isEnum: n.location === 'enumTypes',
        schemaArg: r,
        inputType: n,
      })
    : zo(e, t, r, n)
}
a(ju, 'scalarToArg')
function hi(e, t, r, n, i) {
  t.meta?.source && (r = { modelName: t.meta.source })
  let o = gi(e),
    { fields: s, fieldMap: l } = t,
    u = s.map((d) => [d.name, void 0]),
    c = Object.entries(o || {}),
    f = ga(c, u, (d) => d[0]).reduce((d, [m, h]) => {
      let g = l ? l[m] : s.find((y) => y.name === m)
      if (!g) {
        let y =
          typeof h == 'boolean' && i && i.fields.some((x) => x.name === m)
            ? m
            : null
        return (
          d.push(
            new Se({
              key: m,
              value: h,
              error: {
                type: 'invalidName',
                providedName: m,
                providedValue: h,
                didYouMeanField: y,
                didYouMeanArg:
                  (!y && Dn(m, [...s.map((x) => x.name), 'select'])) || void 0,
                originalType: t,
                possibilities: n,
                outputType: i,
              },
            })
          ),
          d
        )
      }
      let b = mg(m, h, g, r)
      return b && d.push(b), d
    }, [])
  if (
    (typeof t.constraints.minNumFields == 'number' &&
      c.length < t.constraints.minNumFields) ||
    f.find(
      (d) => d.error?.type === 'missingArg' || d.error?.type === 'atLeastOne'
    )
  ) {
    let d = t.fields.filter(
      (m) =>
        !m.isRequired && o && (typeof o[m.name] > 'u' || o[m.name] === null)
    )
    f.push(
      ...d.map((m) => {
        let h = m.inputTypes[0]
        return new Se({
          key: m.name,
          value: void 0,
          isEnum: h.location === 'enumTypes',
          error: {
            type: 'missingArg',
            missingName: m.name,
            missingArg: m,
            atLeastOne: Boolean(t.constraints.minNumFields) || !1,
            atMostOne: t.constraints.maxNumFields === 1 || !1,
          },
          inputType: h,
        })
      })
    )
  }
  return new se(f)
}
a(hi, 'objectToArgs')
function bi({ document: e, path: t, data: r }) {
  let n = Yr(r, t)
  if (n === 'undefined') return null
  if (typeof n != 'object') return n
  let i = yg(e, t)
  return Xo({ field: i, data: n })
}
a(bi, 'unpack')
function Xo({ field: e, data: t }) {
  if (!t || typeof t != 'object' || !e.children || !e.schemaField) return t
  let r = {
    DateTime: (n) => new Date(n),
    Json: (n) => JSON.parse(n),
    Bytes: (n) => Buffer.from(n, 'base64'),
    Decimal: (n) => new ye(n),
    BigInt: (n) => BigInt(n),
  }
  for (let n of e.children) {
    let i = n.schemaField?.outputType.type
    if (i && typeof i == 'string') {
      let o = r[i]
      if (o)
        if (Array.isArray(t))
          for (let s of t)
            typeof s[n.name] < 'u' &&
              s[n.name] !== null &&
              (Array.isArray(s[n.name])
                ? (s[n.name] = s[n.name].map(o))
                : (s[n.name] = o(s[n.name])))
        else
          typeof t[n.name] < 'u' &&
            t[n.name] !== null &&
            (Array.isArray(t[n.name])
              ? (t[n.name] = t[n.name].map(o))
              : (t[n.name] = o(t[n.name])))
    }
    if (
      n.schemaField &&
      n.schemaField.outputType.location === 'outputObjectTypes'
    )
      if (Array.isArray(t)) for (let o of t) Xo({ field: n, data: o[n.name] })
      else Xo({ field: n, data: t[n.name] })
  }
  return t
}
a(Xo, 'mapScalars')
function yg(e, t) {
  let r = t.slice(),
    n = r.shift(),
    i = e.children.find((o) => o.name === n)
  if (!i) throw new Error(`Could not find field ${n} in document ${e}`)
  for (; r.length > 0; ) {
    let o = r.shift()
    if (!i.children)
      throw new Error(`Can't get children for field ${i} with child ${o}`)
    let s = i.children.find((l) => l.name === o)
    if (!s) throw new Error(`Can't find child ${o} of field ${i}`)
    i = s
  }
  return i
}
a(yg, 'getField')
function Ho(e) {
  return e
    .split('.')
    .filter((t) => t !== 'select')
    .join('.')
}
a(Ho, 'removeSelectFromPath')
function Zo(e) {
  if (Object.prototype.toString.call(e) === '[object Object]') {
    let r = {}
    for (let n in e)
      if (n === 'select') for (let i in e.select) r[i] = Zo(e.select[i])
      else r[n] = Zo(e[n])
    return r
  }
  return e
}
a(Zo, 'removeSelectFromObject')
function bg({ ast: e, keyPaths: t, missingItems: r, valuePaths: n }) {
  let i = t.map(Ho),
    o = n.map(Ho),
    s = r.map((u) => ({
      path: Ho(u.path),
      isRequired: u.isRequired,
      type: u.type,
    }))
  return { ast: Zo(e), keyPaths: i, missingItems: s, valuePaths: o }
}
a(bg, 'transformAggregatePrintJsonArgs')
function Zr(e) {
  return {
    getKeys() {
      return Object.keys(e)
    },
    getPropertyValue(t) {
      return e[t]
    },
  }
}
a(Zr, 'addObjectProperties')
function pt(e, t) {
  return {
    getKeys() {
      return [e]
    },
    getPropertyValue() {
      return t()
    },
  }
}
a(pt, 'addProperty')
function vt(e) {
  let t = new Oe()
  return {
    getKeys() {
      return e.getKeys()
    },
    getPropertyValue(r) {
      return t.getOrCreate(r, () => e.getPropertyValue(r))
    },
    getPropertyDescriptor(r) {
      return e.getPropertyDescriptor?.(r)
    },
  }
}
a(vt, 'cacheProperties')
var Ku = require('util')
var Ei = { enumerable: !0, configurable: !0, writable: !0 }
function wi(e) {
  let t = new Set(e)
  return {
    getOwnPropertyDescriptor: () => Ei,
    has: (r, n) => t.has(n),
    set: (r, n, i) => t.add(n) && Reflect.set(r, n, i),
    ownKeys: () => [...t],
  }
}
a(wi, 'defaultProxyHandlers')
var Gu = Symbol.for('nodejs.util.inspect.custom')
function ft(e, t) {
  let r = Eg(t),
    n = new Set(),
    i = new Proxy(e, {
      get(o, s) {
        if (n.has(s)) return o[s]
        let l = r.get(s)
        return l ? l.getPropertyValue(s) : o[s]
      },
      has(o, s) {
        if (n.has(s)) return !0
        let l = r.get(s)
        return l ? l.has?.(s) ?? !0 : Reflect.has(o, s)
      },
      ownKeys(o) {
        let s = Qu(Reflect.ownKeys(o), r),
          l = Qu(Array.from(r.keys()), r)
        return [...new Set([...s, ...l, ...n])]
      },
      set(o, s, l) {
        return r.get(s)?.getPropertyDescriptor?.(s)?.writable === !1
          ? !1
          : (n.add(s), Reflect.set(o, s, l))
      },
      getOwnPropertyDescriptor(o, s) {
        let l = r.get(s)
        return l
          ? l.getPropertyDescriptor
            ? { ...Ei, ...l?.getPropertyDescriptor(s) }
            : Ei
          : Reflect.getOwnPropertyDescriptor(o, s)
      },
      defineProperty(o, s, l) {
        return n.add(s), Reflect.defineProperty(o, s, l)
      },
    })
  return (
    (i[Gu] = function (o, s, l = Ku.inspect) {
      let u = { ...this }
      return delete u[Gu], l(u, s)
    }),
    i
  )
}
a(ft, 'createCompositeProxy')
function Eg(e) {
  let t = new Map()
  for (let r of e) {
    let n = r.getKeys()
    for (let i of n) t.set(i, r)
  }
  return t
}
a(Eg, 'mapKeysToLayers')
function Qu(e, t) {
  return e.filter((r) => t.get(r)?.has?.(r) ?? !0)
}
a(Qu, 'getExistingKeys')
function es(e) {
  return {
    getKeys() {
      return e
    },
    has() {
      return !1
    },
    getPropertyValue() {},
  }
}
a(es, 'removeProperties')
var Ju = O(require('path'))
var en = '<unknown>'
function Wu(e) {
  var t = e.split(`
`)
  return t.reduce(function (r, n) {
    var i = vg(n) || Ag(n) || _g(n) || Ng(n) || Og(n)
    return i && r.push(i), r
  }, [])
}
a(Wu, 'parse')
var wg =
    /^\s*at (.*?) ?\(((?:file|https?|blob|chrome-extension|native|eval|webpack|<anonymous>|\/|[a-z]:\\|\\\\).*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i,
  xg = /\((\S*)(?::(\d+))(?::(\d+))\)/
function vg(e) {
  var t = wg.exec(e)
  if (!t) return null
  var r = t[2] && t[2].indexOf('native') === 0,
    n = t[2] && t[2].indexOf('eval') === 0,
    i = xg.exec(t[2])
  return (
    n && i != null && ((t[2] = i[1]), (t[3] = i[2]), (t[4] = i[3])),
    {
      file: r ? null : t[2],
      methodName: t[1] || en,
      arguments: r ? [t[2]] : [],
      lineNumber: t[3] ? +t[3] : null,
      column: t[4] ? +t[4] : null,
    }
  )
}
a(vg, 'parseChrome')
var Tg =
  /^\s*at (?:((?:\[object object\])?.+) )?\(?((?:file|ms-appx|https?|webpack|blob):.*?):(\d+)(?::(\d+))?\)?\s*$/i
function Ag(e) {
  var t = Tg.exec(e)
  return t
    ? {
        file: t[2],
        methodName: t[1] || en,
        arguments: [],
        lineNumber: +t[3],
        column: t[4] ? +t[4] : null,
      }
    : null
}
a(Ag, 'parseWinjs')
var Sg =
    /^\s*(.*?)(?:\((.*?)\))?(?:^|@)((?:file|https?|blob|chrome|webpack|resource|\[native).*?|[^@]*bundle)(?::(\d+))?(?::(\d+))?\s*$/i,
  Pg = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i
function _g(e) {
  var t = Sg.exec(e)
  if (!t) return null
  var r = t[3] && t[3].indexOf(' > eval') > -1,
    n = Pg.exec(t[3])
  return (
    r && n != null && ((t[3] = n[1]), (t[4] = n[2]), (t[5] = null)),
    {
      file: t[3],
      methodName: t[1] || en,
      arguments: t[2] ? t[2].split(',') : [],
      lineNumber: t[4] ? +t[4] : null,
      column: t[5] ? +t[5] : null,
    }
  )
}
a(_g, 'parseGecko')
var Cg = /^\s*(?:([^@]*)(?:\((.*?)\))?@)?(\S.*?):(\d+)(?::(\d+))?\s*$/i
function Og(e) {
  var t = Cg.exec(e)
  return t
    ? {
        file: t[3],
        methodName: t[1] || en,
        arguments: [],
        lineNumber: +t[4],
        column: t[5] ? +t[5] : null,
      }
    : null
}
a(Og, 'parseJSC')
var Mg =
  /^\s*at (?:((?:\[object object\])?[^\\/]+(?: \[as \S+\])?) )?\(?(.*?):(\d+)(?::(\d+))?\)?\s*$/i
function Ng(e) {
  var t = Mg.exec(e)
  return t
    ? {
        file: t[2],
        methodName: t[1] || en,
        arguments: [],
        lineNumber: +t[3],
        column: t[4] ? +t[4] : null,
      }
    : null
}
a(Ng, 'parseNode')
var xi = class {
  getLocation() {
    return null
  }
}
a(xi, 'DisabledCallSite')
var vi = class {
  constructor() {
    this._error = new Error()
  }
  getLocation() {
    let t = this._error.stack
    if (!t) return null
    let n = Wu(t).find((i) => {
      if (!i.file) return !1
      let o = i.file.split(Ju.default.sep).join('/')
      return (
        o !== '<anonymous>' &&
        !o.includes('@prisma') &&
        !o.includes('/packages/client/src/runtime/') &&
        !o.endsWith('/runtime/binary.js') &&
        !o.endsWith('/runtime/library.js') &&
        !o.endsWith('/runtime/data-proxy.js') &&
        !o.endsWith('/runtime/edge.js') &&
        !o.endsWith('/runtime/edge-esm.js') &&
        !o.startsWith('internal/') &&
        !i.methodName.includes('new ') &&
        !i.methodName.includes('getCallSite') &&
        !i.methodName.includes('Proxy.') &&
        i.methodName.split('.').length < 4
      )
    })
    return !n || !n.file
      ? null
      : { fileName: n.file, lineNumber: n.lineNumber, columnNumber: n.column }
  }
}
a(vi, 'EnabledCallSite')
function dt(e) {
  return e === 'minimal' ? new xi() : new vi()
}
a(dt, 'getCallSite')
function $e(e) {
  let t,
    r = a((n) => {
      try {
        return n === void 0 || n?.kind === 'itx'
          ? t ?? (t = Hu(e(n)))
          : Hu(e(n))
      } catch (i) {
        return Promise.reject(i)
      }
    }, '_callback')
  return {
    then(n, i, o) {
      return r(o).then(n, i, o)
    },
    catch(n, i) {
      return r(i).catch(n, i)
    },
    finally(n, i) {
      return r(i).finally(n, i)
    },
    requestTransaction(n) {
      let i = r(n)
      return i.requestTransaction ? i.requestTransaction(n) : i
    },
    [Symbol.toStringTag]: 'PrismaPromise',
  }
}
a($e, 'createPrismaPromise')
function Hu(e) {
  return typeof e.then == 'function' ? e : Promise.resolve(e)
}
a(Hu, 'valueToPromise')
var Yu = { _avg: !0, _count: !0, _sum: !0, _min: !0, _max: !0 }
function rr(e = {}) {
  let t = Fg(e)
  return Object.entries(t).reduce(
    (n, [i, o]) => (
      Yu[i] !== void 0 ? (n.select[i] = { select: o }) : (n[i] = o), n
    ),
    { select: {} }
  )
}
a(rr, 'desugarUserArgs')
function Fg(e = {}) {
  return typeof e._count == 'boolean' ? { ...e, _count: { _all: e._count } } : e
}
a(Fg, 'desugarCountInUserArgs')
function Ti(e = {}) {
  return (t) => (typeof e._count == 'boolean' && (t._count = t._count._all), t)
}
a(Ti, 'createUnpacker')
function zu(e, t) {
  let r = Ti(e)
  return t({ action: 'aggregate', unpacker: r, argsMapper: rr })(e)
}
a(zu, 'aggregate')
function Ig(e = {}) {
  let { select: t, ...r } = e
  return typeof t == 'object'
    ? rr({ ...r, _count: t })
    : rr({ ...r, _count: { _all: !0 } })
}
a(Ig, 'desugarUserArgs')
function Dg(e = {}) {
  return typeof e.select == 'object'
    ? (t) => Ti(e)(t)._count
    : (t) => Ti(e)(t)._count._all
}
a(Dg, 'createUnpacker')
function Xu(e, t) {
  return t({ action: 'count', unpacker: Dg(e), argsMapper: Ig })(e)
}
a(Xu, 'count')
function kg(e = {}) {
  let t = rr(e)
  if (Array.isArray(t.by))
    for (let r of t.by) typeof r == 'string' && (t.select[r] = !0)
  return t
}
a(kg, 'desugarUserArgs')
function $g(e = {}) {
  return (t) => (
    typeof e?._count == 'boolean' &&
      t.forEach((r) => {
        r._count = r._count._all
      }),
    t
  )
}
a($g, 'createUnpacker')
function Zu(e, t) {
  return t({ action: 'groupBy', unpacker: $g(e), argsMapper: kg })(e)
}
a(Zu, 'groupBy')
function ec(e, t, r) {
  if (t === 'aggregate') return (n) => zu(n, r)
  if (t === 'count') return (n) => Xu(n, r)
  if (t === 'groupBy') return (n) => Zu(n, r)
}
a(ec, 'applyAggregates')
function tc(e) {
  let t = e.fields.filter((n) => !n.relationName),
    r = Bo(t, (n) => n.name)
  return new Proxy(
    {},
    {
      get(n, i) {
        if (i in n || typeof i == 'symbol') return n[i]
        let o = r[i]
        if (o) return new be(e.name, i, o.type, o.isList)
      },
      ...wi(Object.keys(r)),
    }
  )
}
a(tc, 'applyFieldsProxy')
function Lg(e, t) {
  return e === void 0 || t === void 0 ? [] : [...t, 'select', e]
}
a(Lg, 'getNextDataPath')
function jg(e, t, r) {
  return t === void 0 ? e ?? {} : fi(t, r, e || !0)
}
a(jg, 'getNextUserArgs')
function ts(e, t, r, n, i, o) {
  let l = e._baseDmmf.modelMap[t].fields.reduce(
    (u, c) => ({ ...u, [c.name]: c }),
    {}
  )
  return (u) => {
    let c = dt(e._errorFormat),
      p = Lg(n, i),
      f = jg(u, o, p),
      d = r({ dataPath: p, callsite: c })(f),
      m = Bg(e, t)
    return new Proxy(d, {
      get(h, g) {
        if (!m.includes(g)) return h[g]
        let y = [l[g].type, r, g],
          x = [p, f]
        return ts(e, ...y, ...x)
      },
      ...wi([...m, ...Object.getOwnPropertyNames(d)]),
    })
  }
}
a(ts, 'applyFluent')
function Bg(e, t) {
  return e._baseDmmf.modelMap[t].fields
    .filter((r) => r.kind === 'object')
    .map((r) => r.name)
}
a(Bg, 'getOwnKeys')
var Ai = rc().version
var Pe = class extends X {
  constructor(t) {
    super(t, { code: 'P2025', clientVersion: Ai }),
      (this.name = 'NotFoundError')
  }
}
a(Pe, 'NotFoundError')
function rs(e, t, r, n) {
  let i
  if (
    r &&
    typeof r == 'object' &&
    'rejectOnNotFound' in r &&
    r.rejectOnNotFound !== void 0
  )
    (i = r.rejectOnNotFound), delete r.rejectOnNotFound
  else if (typeof n == 'boolean') i = n
  else if (n && typeof n == 'object' && e in n) {
    let o = n[e]
    if (o && typeof o == 'object') return t in o ? o[t] : void 0
    i = rs(e, t, r, o)
  } else typeof n == 'function' ? (i = n) : (i = !1)
  return i
}
a(rs, 'getRejectOnNotFound')
var Vg = /(findUnique|findFirst)/
function nc(e, t, r, n) {
  if ((r ?? (r = 'record'), n && !e && Vg.exec(t)))
    throw typeof n == 'boolean' && n
      ? new Pe(`No ${r} found`)
      : typeof n == 'function'
      ? n(new Pe(`No ${r} found`))
      : Qr(n)
      ? n
      : new Pe(`No ${r} found`)
}
a(nc, 'throwIfNotFound')
function ic(e, t, r) {
  return e === Ie.ModelAction.findFirstOrThrow ||
    e === Ie.ModelAction.findUniqueOrThrow
    ? Ug(t, r)
    : r
}
a(ic, 'adaptErrors')
function Ug(e, t) {
  return async (r) => {
    if ('rejectOnNotFound' in r.args) {
      let i = ct({
        originalMethod: r.clientMethod,
        callsite: r.callsite,
        message: "'rejectOnNotFound' option is not supported",
      })
      throw new J(i)
    }
    return await t(r).catch((i) => {
      throw i instanceof X && i.code === 'P2025' ? new Pe(`No ${e} found`) : i
    })
  }
}
a(Ug, 'applyOrThrowWrapper')
var Gg = [
    'findUnique',
    'findUniqueOrThrow',
    'findFirst',
    'findFirstOrThrow',
    'create',
    'update',
    'upsert',
    'delete',
  ],
  Qg = ['aggregate', 'count', 'groupBy']
function ns(e, t) {
  let r = [Wg(e, t), Kg(t)]
  e._engineConfig.previewFeatures?.includes('fieldReference') &&
    r.push(Yg(e, t))
  let n = e._extensions.getAllModelExtensions(t)
  return n && r.push(Zr(n)), ft({}, r)
}
a(ns, 'applyModel')
function Kg(e) {
  return pt('name', () => e)
}
a(Kg, 'modelMetaLayer')
function Wg(e, t) {
  let r = Te(t),
    n = Jg(e, t)
  return {
    getKeys() {
      return n
    },
    getPropertyValue(i) {
      let o = i,
        s = a((u) => e._request(u), 'requestFn')
      s = ic(o, t, s)
      let l = a(
        (u) => (c) => {
          let p = dt(e._errorFormat)
          return $e((f) => {
            let d = {
              args: c,
              dataPath: [],
              action: o,
              model: t,
              clientMethod: `${r}.${i}`,
              jsModelName: r,
              transaction: f,
              callsite: p,
            }
            return s({ ...d, ...u })
          })
        },
        'action'
      )
      return Gg.includes(o) ? ts(e, t, l) : Hg(i) ? ec(e, i, l) : l({})
    },
  }
}
a(Wg, 'modelActionsLayer')
function Jg(e, t) {
  let r = Object.keys(e._baseDmmf.mappingsMap[t]).filter(
    (n) => n !== 'model' && n !== 'plural'
  )
  return r.push('count'), r
}
a(Jg, 'getOwnKeys')
function Hg(e) {
  return Qg.includes(e)
}
a(Hg, 'isValidAggregateName')
function Yg(e, t) {
  return vt(
    pt('fields', () => {
      let r = e._baseDmmf.modelMap[t]
      return tc(r)
    })
  )
}
a(Yg, 'fieldsPropertyLayer')
function oc(e) {
  return e.replace(/^./, (t) => t.toUpperCase())
}
a(oc, 'jsToDMMFModelName')
var is = Symbol()
function Si(e) {
  let t = [zg(e), pt(is, () => e)],
    r = e._extensions.getAllClientExtensions()
  return r && t.push(Zr(r)), ft(e, t)
}
a(Si, 'applyModelsAndClientExtensions')
function zg(e) {
  let t = Object.keys(e._baseDmmf.modelMap),
    r = t.map(Te),
    n = [...new Set(t.concat(r))]
  return vt({
    getKeys() {
      return n
    },
    getPropertyValue(i) {
      let o = oc(i)
      if (e._baseDmmf.modelMap[o] !== void 0) return ns(e, o)
      if (e._baseDmmf.modelMap[i] !== void 0) return ns(e, i)
    },
    getPropertyDescriptor(i) {
      if (!r.includes(i)) return { enumerable: !1 }
    },
  })
}
a(zg, 'modelsLayer')
function sc(e) {
  return e[is] ? e[is] : e
}
a(sc, 'unapplyModelsAndClientExtensions')
function ac(e) {
  if (!this._hasPreviewFlag('clientExtensions'))
    throw new J(
      'Extensions are not yet generally available, please add `clientExtensions` to the `previewFeatures` field in the `generator` block in the `schema.prisma` file.'
    )
  if (typeof e == 'function') return e(this)
  let t = sc(this),
    r = Object.create(t, { _extensions: { value: this._extensions.append(e) } })
  return Si(r)
}
a(ac, '$extends')
function Le(e) {
  if (typeof e != 'object') return e
  var t,
    r,
    n = Object.prototype.toString.call(e)
  if (n === '[object Object]') {
    if (e.constructor !== Object && typeof e.constructor == 'function') {
      r = new e.constructor()
      for (t in e) e.hasOwnProperty(t) && r[t] !== e[t] && (r[t] = Le(e[t]))
    } else {
      r = {}
      for (t in e)
        t === '__proto__'
          ? Object.defineProperty(r, t, {
              value: Le(e[t]),
              configurable: !0,
              enumerable: !0,
              writable: !0,
            })
          : (r[t] = Le(e[t]))
    }
    return r
  }
  if (n === '[object Array]') {
    for (t = e.length, r = Array(t); t--; ) r[t] = Le(e[t])
    return r
  }
  return n === '[object Set]'
    ? ((r = new Set()),
      e.forEach(function (i) {
        r.add(Le(i))
      }),
      r)
    : n === '[object Map]'
    ? ((r = new Map()),
      e.forEach(function (i, o) {
        r.set(Le(o), Le(i))
      }),
      r)
    : n === '[object Date]'
    ? new Date(+e)
    : n === '[object RegExp]'
    ? ((r = new RegExp(e.source, e.flags)), (r.lastIndex = e.lastIndex), r)
    : n === '[object DataView]'
    ? new e.constructor(Le(e.buffer))
    : n === '[object ArrayBuffer]'
    ? e.slice(0)
    : n.slice(-6) === 'Array]'
    ? new e.constructor(e)
    : e
}
a(Le, 'klona')
function lc(e, t, r, n = 0) {
  return $e((i) => {
    let o = t.customDataProxyFetch ?? ((s) => s)
    return (
      i !== void 0 &&
        (t.transaction?.kind === 'batch' && t.transaction.lock.then(),
        (t.transaction = i)),
      n === r.length
        ? e._executeRequest(t)
        : r[n]({
            model: t.model,
            operation: t.model ? t.action : t.clientMethod,
            args: Le(t.args ?? {}),
            __internalParams: t,
            query: (s, l = t) => {
              let u = l.customDataProxyFetch ?? ((c) => c)
              return (
                (l.customDataProxyFetch = (c) => o(u(c))),
                (l.args = s),
                lc(e, l, r, n + 1)
              )
            },
          })
    )
  })
}
a(lc, 'iterateAndCallQueryCallbacks')
function uc(e, t) {
  let { jsModelName: r, action: n, clientMethod: i } = t,
    o = r ? n : i
  if (e._extensions.isEmpty()) return e._executeRequest(t)
  let s = e._extensions.getAllQueryCallbacks(r ?? '*', o)
  return lc(e, t, s)
}
a(uc, 'applyQueryExtensions')
function cc(e) {
  let t
  return {
    get() {
      return t || (t = { value: e() }), t.value
    },
  }
}
a(cc, 'lazyProperty')
var tn = class {
  constructor(t, r) {
    this.extension = t
    this.previous = r
    this.computedFieldsCache = new Oe()
    this.modelExtensionsCache = new Oe()
    this.queryCallbacksCache = new Oe()
    this.clientExtensions = cc(() =>
      this.extension.client
        ? {
            ...this.previous?.getAllClientExtensions(),
            ...this.extension.client,
          }
        : this.previous?.getAllClientExtensions()
    )
  }
  getAllComputedFields(t) {
    return this.computedFieldsCache.getOrCreate(t, () =>
      hu(this.previous?.getAllComputedFields(t), this.extension, t)
    )
  }
  getAllClientExtensions() {
    return this.clientExtensions.get()
  }
  getAllModelExtensions(t) {
    return this.modelExtensionsCache.getOrCreate(t, () => {
      let r = Te(t)
      return !this.extension.model ||
        !(this.extension.model[r] || this.extension.model.$allModels)
        ? this.previous?.getAllModelExtensions(t)
        : {
            ...this.previous?.getAllModelExtensions(t),
            ...this.extension.model.$allModels,
            ...this.extension.model[r],
          }
    })
  }
  getAllQueryCallbacks(t, r) {
    return this.queryCallbacksCache.getOrCreate(`${t}:${r}`, () => {
      let n = this.previous?.getAllQueryCallbacks(t, r) ?? [],
        i = [],
        o = this.extension.query
      return !o || !(o[t] || o.$allModels || o[r])
        ? n
        : (o[t] !== void 0 &&
            (o[t][r] !== void 0 && i.push(o[t][r]),
            o[t].$allOperations !== void 0 && i.push(o[t].$allOperations)),
          o.$allModels !== void 0 &&
            (o.$allModels[r] !== void 0 && i.push(o.$allModels[r]),
            o.$allModels.$allOperations !== void 0 &&
              i.push(o.$allModels.$allOperations)),
          o[r] !== void 0 && i.push(o[r]),
          n.concat(i))
    })
  }
}
a(tn, 'MergedExtensionsListNode')
var Qe = class {
  constructor(t) {
    this.head = t
  }
  static empty() {
    return new Qe()
  }
  static single(t) {
    return new Qe(new tn(t))
  }
  isEmpty() {
    return this.head === void 0
  }
  append(t) {
    return new Qe(new tn(t, this.head))
  }
  getAllComputedFields(t) {
    return this.head?.getAllComputedFields(t)
  }
  getAllClientExtensions() {
    return this.head?.getAllClientExtensions()
  }
  getAllModelExtensions(t) {
    return this.head?.getAllModelExtensions(t)
  }
  getAllQueryCallbacks(t, r) {
    return this.head?.getAllQueryCallbacks(t, r) ?? []
  }
}
a(Qe, 'MergedExtensionsList')
var Xg = {
    findUnique: 'query',
    findUniqueOrThrow: 'query',
    findFirst: 'query',
    findFirstOrThrow: 'query',
    findMany: 'query',
    count: 'query',
    create: 'mutation',
    createMany: 'mutation',
    update: 'mutation',
    updateMany: 'mutation',
    upsert: 'mutation',
    delete: 'mutation',
    deleteMany: 'mutation',
    executeRaw: 'mutation',
    queryRaw: 'mutation',
    aggregate: 'query',
    groupBy: 'query',
    runCommandRaw: 'mutation',
    findRaw: 'query',
    aggregateRaw: 'query',
  },
  rn = class {
    constructor(t, r) {
      this.dmmf = t
      this.errorFormat = r
    }
    createMessage({
      action: t,
      modelName: r,
      args: n,
      extensions: i,
      clientMethod: o,
      callsite: s,
    }) {
      let l,
        u = Xg[t]
      ;(t === 'executeRaw' || t === 'queryRaw' || t === 'runCommandRaw') &&
        (l = t)
      let c
      if (r !== void 0) {
        if (((c = this.dmmf?.mappingsMap[r]), c === void 0))
          throw new Error(`Could not find mapping for model ${r}`)
        l = c[t === 'count' ? 'aggregate' : t]
      }
      if (u !== 'query' && u !== 'mutation')
        throw new Error(`Invalid operation ${u} for action ${t}`)
      if (this.dmmf?.rootFieldMap[l] === void 0)
        throw new Error(
          `Could not find rootField ${l} for action ${t} for model ${r} on rootType ${u}`
        )
      let f = yi({
        dmmf: this.dmmf,
        rootField: l,
        rootTypeName: u,
        select: n,
        modelName: r,
        extensions: i,
      })
      return f.validate(n, !1, o, this.errorFormat, s), new Pi(f)
    }
    createBatch(t) {
      return t.map((r) => r.toEngineQuery())
    }
  }
a(rn, 'GraphQLProtocolEncoder')
var Pi = class {
  constructor(t) {
    this.document = t
  }
  isWrite() {
    return this.document.type === 'mutation'
  }
  getBatchId() {
    if (!this.getRootField().startsWith('findUnique')) return
    let t = this.document.children[0].args?.args
        .map((n) =>
          n.value instanceof se
            ? `${n.key}-${n.value.args.map((i) => i.key).join(',')}`
            : n.key
        )
        .join(','),
      r = this.document.children[0].children.join(',')
    return `${this.document.children[0].name}|${t}|${r}`
  }
  toDebugString() {
    return String(this.document)
  }
  toEngineQuery() {
    return { query: String(this.document), variables: {} }
  }
  deserializeResponse(t, r) {
    let n = this.getRootField(),
      i = []
    return (
      n && i.push(n),
      i.push(...r.filter((o) => o !== 'select' && o !== 'include')),
      bi({ document: this.document, path: i, data: t })
    )
  }
  getRootField() {
    return this.document.children[0].name
  }
}
a(Pi, 'GraphQLMessage')
function _i(e) {
  return e === null
    ? e
    : Array.isArray(e)
    ? e.map(_i)
    : typeof e == 'object'
    ? Zg(e)
      ? eh(e)
      : Zt(e, _i)
    : e
}
a(_i, 'deserializeJsonResponse')
function Zg(e) {
  return e !== null && typeof e == 'object' && typeof e.$type == 'string'
}
a(Zg, 'isTaggedValue')
function eh({ $type: e, value: t }) {
  switch (e) {
    case 'BigInt':
      return BigInt(t)
    case 'Bytes':
      return Buffer.from(t, 'base64')
    case 'DateTime':
      return new Date(t)
    case 'Decimal':
      return new ye(t)
    case 'Json':
      return JSON.parse(t)
    default:
      Ge(t, 'Unknown tagged value')
  }
}
a(eh, 'deserializeTaggedValue')
var xc = O(ae())
var nn = class {
  constructor(t = 0, r) {
    this.context = r
    this.lines = []
    this.currentLine = ''
    this.currentIndent = 0
    this.currentIndent = t
  }
  write(t) {
    return typeof t == 'string' ? (this.currentLine += t) : t.write(this), this
  }
  writeJoined(t, r) {
    let n = r.length - 1
    for (let i = 0; i < r.length; i++)
      this.write(r[i]), i !== n && this.write(t)
    return this
  }
  writeLine(t) {
    return this.write(t).newLine()
  }
  newLine() {
    this.lines.push(this.indentedCurrentLine()),
      (this.currentLine = ''),
      (this.marginSymbol = void 0)
    let t = this.afterNextNewLineCallback
    return (this.afterNextNewLineCallback = void 0), t?.(), this
  }
  withIndent(t) {
    return this.indent(), t(this), this.unindent(), this
  }
  afterNextNewline(t) {
    return (this.afterNextNewLineCallback = t), this
  }
  indent() {
    return this.currentIndent++, this
  }
  unindent() {
    return this.currentIndent > 0 && this.currentIndent--, this
  }
  addMarginSymbol(t) {
    return (this.marginSymbol = t), this
  }
  toString() {
    return this.lines.concat(this.indentedCurrentLine()).join(`
`)
  }
  getCurrentLineLength() {
    return this.currentLine.length
  }
  indentedCurrentLine() {
    let t = this.currentLine.padStart(
      this.currentLine.length + 2 * this.currentIndent
    )
    return this.marginSymbol ? this.marginSymbol + t.slice(1) : t
  }
}
a(nn, 'Writer')
var fc = O(Rn())
var je = class {
  constructor(t, r) {
    this.name = t
    this.value = r
    this.isRequired = !1
  }
  makeRequired() {
    return (this.isRequired = !0), this
  }
  write(t) {
    let { chalk: r } = t.context
    t.addMarginSymbol(r.greenBright(this.isRequired ? '+' : '?')),
      t.write(r.greenBright(this.name)),
      this.isRequired || t.write(r.greenBright('?')),
      t.write(r.greenBright(': ')),
      typeof this.value == 'string'
        ? t.write(r.greenBright(this.value))
        : t.write(this.value)
  }
}
a(je, 'ObjectFieldSuggestion')
var nr = {
  write(e) {
    e.writeLine(',')
  },
}
var Ne = class {
  constructor(t) {
    this.contents = t
    this.isUnderlined = !1
    this.color = a((t) => t, 'color')
  }
  underline() {
    return (this.isUnderlined = !0), this
  }
  setColor(t) {
    return (this.color = t), this
  }
  write(t) {
    let r = t.getCurrentLineLength()
    t.write(this.color(this.contents)),
      this.isUnderlined &&
        t.afterNextNewline(() => {
          t.write(' '.repeat(r)).writeLine(
            this.color('~'.repeat(this.contents.length))
          )
        })
  }
}
a(Ne, 'FormattedString')
var Ke = class {
  constructor() {
    this.hasError = !1
  }
  markAsError() {
    return (this.hasError = !0), this
  }
}
a(Ke, 'Value')
var j = class extends Ke {
  constructor() {
    super(...arguments)
    this.fields = {}
    this.suggestions = []
  }
  addField(r) {
    this.fields[r.name] = r
  }
  addSuggestion(r) {
    this.suggestions.push(r)
  }
  getField(r) {
    return this.fields[r]
  }
  getDeepField(r) {
    let [n, ...i] = r,
      o = this.getField(n)
    if (!o) return
    let s = o
    for (let l of i) {
      if (!(s.value instanceof j)) return
      let u = s.value.getField(l)
      if (!u) return
      s = u
    }
    return s
  }
  getDeepFieldValue(r) {
    return r.length === 0 ? this : this.getDeepField(r)?.value
  }
  hasField(r) {
    return Boolean(this.getField(r))
  }
  removeAllFields() {
    this.fields = {}
  }
  getFields() {
    return this.fields
  }
  isEmpty() {
    return Object.keys(this.fields).length === 0
  }
  getFieldValue(r) {
    return this.getField(r)?.value
  }
  getDeepSubSelectionValue(r) {
    let n = this
    for (let i of r) {
      if (!(n instanceof j)) return
      let o = n.getSubSelectionValue(i)
      if (!o) return
      n = o
    }
    return n
  }
  getDeepSelectionParent(r) {
    let n = this.getSelectionParent()
    if (!n) return
    let i = n
    for (let o of r) {
      let s = i.value.getFieldValue(o)
      if (!s || !(s instanceof j)) return
      let l = s.getSelectionParent()
      if (!l) return
      i = l
    }
    return i
  }
  getSelectionParent() {
    let r = this.getField('select')
    if (r?.value instanceof j) return { kind: 'select', value: r.value }
    let n = this.getField('include')
    if (n?.value instanceof j) return { kind: 'include', value: n.value }
  }
  getSubSelectionValue(r) {
    return this.getSelectionParent()?.value.fields[r].value
  }
  getPrintWidth() {
    let r = Object.values(this.fields)
    return r.length == 0 ? 2 : Math.max(...r.map((i) => i.getPrintWidth())) + 2
  }
  write(r) {
    let n = Object.values(this.fields)
    if (n.length === 0 && this.suggestions.length === 0) {
      this.writeEmpty(r)
      return
    }
    this.writeWithContents(r, n)
  }
  writeEmpty(r) {
    let n = new Ne('{}')
    this.hasError && n.setColor(r.context.chalk.redBright).underline(),
      r.write(n)
  }
  writeWithContents(r, n) {
    r.writeLine('{').withIndent(() => {
      r.writeJoined(nr, [...n, ...this.suggestions]).newLine()
    }),
      r.write('}'),
      this.hasError &&
        r.afterNextNewline(() => {
          r.writeLine(
            r.context.chalk.redBright('~'.repeat(this.getPrintWidth()))
          )
        })
  }
}
a(j, 'ObjectValue')
var ee = class extends Ke {
  constructor(r) {
    super()
    this.text = r
  }
  getPrintWidth() {
    return this.text.length
  }
  write(r) {
    let n = new Ne(this.text)
    this.hasError && n.underline().setColor(r.context.chalk.redBright),
      r.write(n)
  }
}
a(ee, 'ScalarValue')
var on = class {
  constructor() {
    this.fields = []
  }
  addField(t, r) {
    return (
      this.fields.push({
        write(n) {
          let i = n.context.chalk
          n.write(i.greenBright.dim(`${t}: ${r}`)).addMarginSymbol(
            i.greenBright.dim('+')
          )
        },
      }),
      this
    )
  }
  write(t) {
    let { chalk: r } = t.context
    t.writeLine(r.greenBright('{'))
      .withIndent(() => {
        t.writeJoined(nr, this.fields).newLine()
      })
      .write(r.greenBright('}'))
      .addMarginSymbol(r.greenBright('+'))
  }
}
a(on, 'SuggestionObjectValue')
function Ci(e, t) {
  switch (e.kind) {
    case 'IncludeAndSelect':
      rh(e, t)
      break
    case 'IncludeOnScalar':
      nh(e, t)
      break
    case 'EmptySelection':
      ih(e, t)
      break
    case 'UnknownSelectionField':
      oh(e, t)
      break
    case 'UnknownArgument':
      sh(e, t)
      break
    case 'UnknownInputField':
      ah(e, t)
      break
    case 'RequiredArgumentMissing':
      lh(e, t)
      break
    case 'InvalidArgumentType':
      uh(e, t)
      break
    case 'InvalidArgumentValue':
      ch(e, t)
      break
    case 'ValueTooLarge':
      ph(e, t)
      break
    case 'SomeFieldsMissing':
      fh(e, t)
      break
    case 'TooManyFieldsGiven':
      dh(e, t)
      break
    case 'Union':
      mh(e, t)
      break
    default:
      throw (console.log(e), new Error('not implemented: ' + e.kind))
  }
}
a(Ci, 'applyValidationError')
function rh(e, t) {
  let r = t.arguments.getDeepSubSelectionValue(e.selectionPath)
  r &&
    r instanceof j &&
    (r.getField('include')?.markAsError(), r.getField('select')?.markAsError()),
    t.addErrorMessage(
      (n) =>
        `Please ${n.bold('either')} use ${n.greenBright(
          '`include`'
        )} or ${n.greenBright('`select`')}, but ${n.redBright(
          'not both'
        )} at the same time.`
    )
}
a(rh, 'applyIncludeAndSelectError')
function nh(e, t) {
  let [r, n] = Oi(e.selectionPath),
    i = e.outputType,
    o = t.arguments.getDeepSelectionParent(r)?.value
  if (o && (o.getField(n)?.markAsError(), i))
    for (let s of i.fields)
      s.isRelation && o.addSuggestion(new je(s.name, 'true'))
  t.addErrorMessage((s) => {
    let l = `Invalid scalar field ${s.redBright(`\`${n}\``)} for ${s.bold(
      'include'
    )} statement`
    return (
      i ? (l += ` on model ${s.bold(i.name)}. ${sn(s)}`) : (l += '.'),
      (l += `
Note that ${s.bold('include')} statements only accept relation fields.`),
      l
    )
  })
}
a(nh, 'applyIncludeOnScalarError')
function ih(e, t) {
  let r = e.outputType,
    n = t.arguments.getDeepSelectionParent(e.selectionPath)?.value,
    i = n?.isEmpty() ?? !1
  n && (n.removeAllFields(), gc(n, r)),
    t.addErrorMessage((o) =>
      i
        ? `The ${o.red('`select`')} statement for type ${o.bold(
            r.name
          )} must not be empty. ${sn(o)}`
        : `The ${o.red('`select`')} statement for type ${o.bold(
            r.name
          )} needs ${o.bold('at least one truthy value')}.`
    )
}
a(ih, 'applyEmptySelectionError')
function oh(e, t) {
  let [r, n] = Oi(e.selectionPath),
    i = t.arguments.getDeepSelectionParent(r)
  i && (i.value.getField(n)?.markAsError(), gc(i.value, e.outputType)),
    t.addErrorMessage((o) => {
      let s = [`Unknown field ${o.redBright(`\`${n}\``)}`]
      return (
        i && s.push(`for ${o.bold(i.kind)} statement`),
        s.push(`on model ${o.bold(`\`${e.outputType.name}\``)}.`),
        s.push(sn(o)),
        s.join(' ')
      )
    })
}
a(oh, 'applyUnknownSelectionFieldError')
function sh(e, t) {
  let r = e.argumentPath[0],
    n = t.arguments.getDeepSubSelectionValue(e.selectionPath)
  n instanceof j && (n.getField(r)?.markAsError(), yh(n, e.arguments)),
    t.addErrorMessage((i) =>
      dc(
        i,
        r,
        e.arguments.map((o) => o.name)
      )
    )
}
a(sh, 'applyUnknownArgumentError')
function ah(e, t) {
  let [r, n] = Oi(e.argumentPath),
    i = t.arguments.getDeepSubSelectionValue(e.selectionPath)
  if (i instanceof j) {
    i.getDeepField(e.argumentPath)?.markAsError()
    let o = i.getDeepFieldValue(r)
    o instanceof j && hc(o, e.inputType)
  }
  t.addErrorMessage((o) =>
    dc(
      o,
      n,
      e.inputType.fields.map((s) => s.name)
    )
  )
}
a(ah, 'applyUnknownInputFieldError')
function dc(e, t, r) {
  let n = [`Unknown argument \`${e.redBright(t)}\`.`],
    i = Eh(t, r)
  return (
    i && n.push(`Did you mean \`${e.greenBright(i)}\`?`),
    r.length > 0 && n.push(sn(e)),
    n.join(' ')
  )
}
a(dc, 'unknownArgumentMessage')
function lh(e, t) {
  t.addErrorMessage((l) => `Argument \`${l.greenBright(i)}\` is missing.`)
  let r = t.arguments.getDeepSubSelectionValue(e.selectionPath)
  if (!(r instanceof j)) return
  let [n, i] = Oi(e.argumentPath),
    o = new on(),
    s = r.getDeepFieldValue(n)
  if (s instanceof j)
    if (e.inputTypes.length === 1 && e.inputTypes[0].kind === 'object') {
      for (let l of e.inputTypes[0].fields)
        o.addField(l.name, l.typeNames.join(' | '))
      s.addSuggestion(new je(i, o).makeRequired())
    } else {
      let l = e.inputTypes.map(mc).join(' | ')
      s.addSuggestion(new je(i, l).makeRequired())
    }
}
a(lh, 'applyRequiredArgumentMissingError')
function mc(e) {
  return e.kind === 'list' ? `${mc(e.elementType)}[]` : e.name
}
a(mc, 'getInputTypeName')
function uh(e, t) {
  let r = e.argument.name,
    n = t.arguments.getDeepSubSelectionValue(e.selectionPath)
  n instanceof j && n.getDeepFieldValue(e.argumentPath)?.markAsError(),
    t.addErrorMessage((i) => {
      let o = Mi(
        'or',
        e.argument.typeNames.map((s) => i.greenBright(s))
      )
      return `Argument \`${i.bold(
        r
      )}\`: Invalid value provided. Expected ${o}, provided ${i.redBright(
        e.inferredType
      )}.`
    })
}
a(uh, 'applyInvalidArgumentTypeError')
function ch(e, t) {
  let r = e.argument.name,
    n = t.arguments.getDeepSubSelectionValue(e.selectionPath)
  n instanceof j && n.getDeepFieldValue(e.argumentPath)?.markAsError(),
    t.addErrorMessage((i) => {
      let o = Mi(
        'or',
        e.argument.typeNames.map((s) => i.greenBright(s))
      )
      return `Invalid value for argument \`${i.bold(r)}\`: ${
        e.underlyingError
      }. Expected ${o}.`
    })
}
a(ch, 'applyInvalidArgumentValueError')
function ph(e, t) {
  let r = e.argument.name,
    n = t.arguments.getDeepSubSelectionValue(e.selectionPath),
    i
  if (n instanceof j) {
    let s = n.getDeepField(e.argumentPath)?.value
    s?.markAsError(), s instanceof ee && (i = s.text)
  }
  t.addErrorMessage((o) => {
    let s = ['Unable to fit value']
    return (
      i && s.push(o.redBright(i)),
      s.push(`into a 64-bit signed integer for field \`${o.bold(r)}\``),
      s.join(' ')
    )
  })
}
a(ph, 'applyValueTooLargeError')
function fh(e, t) {
  let r = e.argumentPath[e.argumentPath.length - 1],
    n = t.arguments.getDeepSubSelectionValue(e.selectionPath)
  if (n instanceof j) {
    let i = n.getDeepFieldValue(e.argumentPath)
    i instanceof j && hc(i, e.inputType)
  }
  t.addErrorMessage((i) => {
    let o = [
      `Argument \`${i.bold(r)}\` of type ${i.bold(e.inputType.name)} needs`,
    ]
    return (
      e.constraints.minFieldCount === 1
        ? e.constraints.requiredFields
          ? o.push(
              `${i.greenBright('at least one of')} ${Mi(
                'or',
                e.constraints.requiredFields.map((s) => `\`${i.bold(s)}\``)
              )} arguments.`
            )
          : o.push(`${i.greenBright('at least one')} argument.`)
        : o.push(
            `${i.greenBright(
              `at least ${e.constraints.minFieldCount}`
            )} arguments.`
          ),
      o.push(sn(i)),
      o.join(' ')
    )
  })
}
a(fh, 'applySomeFieldsMissingError')
function dh(e, t) {
  let r = e.argumentPath[e.argumentPath.length - 1],
    n = t.arguments.getDeepSubSelectionValue(e.selectionPath),
    i = []
  if (n instanceof j) {
    let o = n.getDeepFieldValue(e.argumentPath)
    o instanceof j && (o.markAsError(), (i = Object.keys(o.getFields())))
  }
  t.addErrorMessage((o) => {
    let s = [
      `Argument \`${o.bold(r)}\` of type ${o.bold(e.inputType.name)} needs`,
    ]
    return (
      e.constraints.minFieldCount === 1 && e.constraints.maxFieldCount == 1
        ? s.push(`${o.greenBright('exactly one')} argument,`)
        : e.constraints.maxFieldCount == 1
        ? s.push(`${o.greenBright('at most one')} argument,`)
        : s.push(
            `${o.greenBright(
              `at most ${e.constraints.maxFieldCount}`
            )} arguments,`
          ),
      s.push(
        `but you provided ${Mi(
          'and',
          i.map((l) => o.redBright(l))
        )}. Please choose`
      ),
      e.constraints.maxFieldCount === 1
        ? s.push('one.')
        : s.push(`${e.constraints.maxFieldCount}.`),
      s.join(' ')
    )
  })
}
a(dh, 'applyTooManyFieldsGivenError')
function mh(e, t) {
  let r = gh(e)
  if (r) {
    Ci(r, t)
    return
  }
  let n = hh(e)
  if (n) {
    Ci(n, t)
    return
  }
  t.addErrorMessage(() => 'Unknown error')
}
a(mh, 'applyUnionError')
function gh({ errors: e }) {
  if (e.length === 0 || e[0].kind !== 'InvalidArgumentType') return
  let t = { ...e[0], argument: { ...e[0].argument } }
  for (let r = 1; r < e.length; r++) {
    let n = e[r]
    if (
      n.kind !== 'InvalidArgumentType' ||
      !pc(n.selectionPath, t.selectionPath) ||
      !pc(n.argumentPath, t.argumentPath)
    )
      return
    t.argument.typeNames = t.argument.typeNames.concat(n.argument.typeNames)
  }
  return t
}
a(gh, 'tryMergingUnionError')
function pc(e, t) {
  if (e.length !== t.length) return !1
  for (let r = 0; r < e.length; r++) if (e[r] !== t[r]) return !1
  return !0
}
a(pc, 'isSamePath')
function hh(e) {
  return qo(e.errors, (t) => {
    let r = 0
    return (
      Array.isArray(t.selectionPath) && (r += t.selectionPath.length),
      Array.isArray(t.argumentPath) && (r += t.argumentPath.length),
      r
    )
  })
}
a(hh, 'getLongestPathError')
function gc(e, t) {
  for (let r of t.fields)
    e.hasField(r.name) || e.addSuggestion(new je(r.name, 'true'))
}
a(gc, 'addSelectionSuggestions')
function yh(e, t) {
  for (let r of t)
    e.hasField(r.name) ||
      e.addSuggestion(new je(r.name, r.typeNames.join(' | ')))
}
a(yh, 'addArgumentsSuggestions')
function hc(e, t) {
  if (t.kind === 'object')
    for (let r of t.fields)
      e.hasField(r.name) ||
        e.addSuggestion(new je(r.name, r.typeNames.join(' | ')))
}
a(hc, 'addInputSuggestions')
function Oi(e) {
  let t = [...e],
    r = t.pop()
  if (!r) throw new Error('unexpected empty path')
  return [t, r]
}
a(Oi, 'splitPath')
function sn(e) {
  return `Available options are listed in ${e.greenBright('green')}.`
}
a(sn, 'availableOptionsMessage')
function Mi(e, t) {
  if (t.length === 1) return t[0]
  let r = [...t],
    n = r.pop()
  return `${r.join(', ')} ${e} ${n}`
}
a(Mi, 'joinWithPreposition')
var bh = 3
function Eh(e, t) {
  let r = 1 / 0,
    n
  for (let i of t) {
    let o = (0, fc.default)(e, i)
    o > bh || (o < r && ((r = o), (n = i)))
  }
  return n
}
a(Eh, 'getSuggestion')
var an = class extends Ke {
  constructor() {
    super(...arguments)
    this.items = []
  }
  addItem(r) {
    return this.items.push(r), this
  }
  getPrintWidth() {
    return Math.max(...this.items.map((n) => n.getPrintWidth())) + 2
  }
  write(r) {
    if (this.items.length === 0) {
      this.writeEmpty(r)
      return
    }
    this.writeWithItems(r)
  }
  writeEmpty(r) {
    let n = new Ne('[]')
    this.hasError && n.setColor(r.context.chalk.redBright).underline(),
      r.write(n)
  }
  writeWithItems(r) {
    let { chalk: n } = r.context
    r
      .writeLine('[')
      .withIndent(() => r.writeJoined(nr, this.items).newLine())
      .write(']'),
      this.hasError &&
        r.afterNextNewline(() => {
          r.writeLine(n.redBright('~'.repeat(this.getPrintWidth())))
        })
  }
}
a(an, 'ArrayValue')
var yc = ': ',
  ln = class {
    constructor(t, r) {
      this.name = t
      this.value = r
      this.hasError = !1
    }
    markAsError() {
      this.hasError = !0
    }
    getPrintWidth() {
      return this.name.length + this.value.getPrintWidth() + yc.length
    }
    write(t) {
      let r = new Ne(this.name)
      this.hasError && r.underline().setColor(t.context.chalk.redBright),
        t.write(r).write(yc).write(this.value)
    }
  }
a(ln, 'ObjectField')
var Ni = class {
  constructor(t) {
    this.errorMessages = []
    this.arguments = t
  }
  write(t) {
    t.write(this.arguments)
  }
  addErrorMessage(t) {
    this.errorMessages.push(t)
  }
  renderAllMessages(t) {
    return this.errorMessages.map((r) => r(t)).join(`
`)
  }
}
a(Ni, 'ArgumentsRenderingTree')
function bc(e) {
  return new Ni(Ec(e))
}
a(bc, 'buildArgumentsRenderingTree')
function Ec(e) {
  let t = new j()
  for (let [r, n] of Object.entries(e)) {
    let i = new ln(r, wc(n))
    t.addField(i)
  }
  return t
}
a(Ec, 'buildInputObject')
function wc(e) {
  if (typeof e == 'string') return new ee(JSON.stringify(e))
  if (typeof e == 'number' || typeof e == 'boolean') return new ee(String(e))
  if (typeof e == 'bigint') return new ee(`${e}n`)
  if (e === null) return new ee('null')
  if (e === void 0) return new ee('undefined')
  if (Xe(e)) return new ee(`new Prisma.Decimal("${e.toFixed()}")`)
  if (e instanceof Uint8Array)
    return Buffer.isBuffer(e)
      ? new ee(`Buffer.alloc(${e.byteLength})`)
      : new ee(`new Uint8Array(${e.byteLength})`)
  if (e instanceof Date) return new ee(`new Date("${e.toISOString()}")`)
  if (e instanceof Y) return new ee(`Prisma.${e._getName()}`)
  if (Fn(e)) return new ee(`prisma.${$t(e.modelName)}.$fields.${e.name}`)
  if (Array.isArray(e)) return wh(e)
  if (typeof e == 'object') return Ec(e)
  Ge(e, 'Unknown value type')
}
a(wc, 'buildInputValue')
function wh(e) {
  let t = new an()
  for (let r of e) t.addItem(wc(r))
  return t
}
a(wh, 'buildInputArray')
function Ri({
  args: e,
  errors: t,
  errorFormat: r,
  callsite: n,
  originalMethod: i,
}) {
  let o = bc(e)
  for (let p of t) Ci(p, o)
  let s = new xc.default.Instance()
  r !== 'pretty' && (s.level = 0)
  let l = o.renderAllMessages(s),
    u = new nn(0, { chalk: s }).write(o).toString(),
    c = ct({
      message: l,
      callsite: n,
      originalMethod: i,
      showColors: r === 'pretty',
      callArguments: u,
    })
  throw new J(c)
}
a(Ri, 'throwValidationException')
var xh = {
  findUnique: 'findUnique',
  findUniqueOrThrow: 'findUniqueOrThrow',
  findFirst: 'findFirst',
  findFirstOrThrow: 'findFirstOrThrow',
  findMany: 'findMany',
  count: 'aggregate',
  create: 'createOne',
  createMany: 'createMany',
  update: 'updateOne',
  updateMany: 'updateMany',
  upsert: 'upsertOne',
  delete: 'deleteOne',
  deleteMany: 'deleteMany',
  executeRaw: 'executeRaw',
  queryRaw: 'queryRaw',
  aggregate: 'aggregate',
  groupBy: 'groupBy',
  runCommandRaw: 'runCommandRaw',
  findRaw: 'findRaw',
  aggregateRaw: 'aggregateRaw',
}
function vc({
  modelName: e,
  action: t,
  args: r,
  baseDmmf: n,
  extensions: i,
  callsite: o,
  clientMethod: s,
  errorFormat: l,
}) {
  let u = new ir({
    baseDmmf: n,
    modelName: e,
    action: t,
    rootArgs: r,
    callsite: o,
    extensions: i,
    path: [],
    originalMethod: s,
    errorFormat: l,
  })
  return { modelName: e, action: xh[t], query: os(r, u) }
}
a(vc, 'serializeJsonQuery')
function os({ select: e, include: t, ...r } = {}, n) {
  return { arguments: Ac(r), selection: vh(e, t, n) }
}
a(os, 'serializeFieldSelection')
function vh(e, t, r) {
  return (
    e &&
      t &&
      r.throwValidationError({
        kind: 'IncludeAndSelect',
        selectionPath: r.getSelectionPath(),
      }),
    e ? Sh(e, r) : Th(r, t)
  )
}
a(vh, 'serializeSelectionSet')
function Th(e, t) {
  let r = {}
  return (
    e.model && !e.isRawAction() && ((r.$composites = !0), (r.$scalars = !0)),
    t && Ah(r, t, e),
    r
  )
}
a(Th, 'createImplicitSelection')
function Ah(e, t, r) {
  for (let [n, i] of Object.entries(t)) {
    let o = r.findField(n)
    o &&
      o?.kind !== 'object' &&
      r.throwValidationError({
        kind: 'IncludeOnScalar',
        selectionPath: r.getSelectionPath().concat(n),
        outputType: r.getOutputTypeDescription(),
      }),
      i === !0
        ? (e[n] = { selection: { $composites: !0, $scalars: !0 } })
        : typeof i == 'object' && (e[n] = os(i, r.atField(n)))
  }
}
a(Ah, 'addIncludedRelations')
function Sh(e, t) {
  let r = {},
    n = t.getComputedFields(),
    i = ui(e, n)
  for (let [o, s] of Object.entries(i)) {
    let l = t.findField(o)
    ;(n?.[o] && !l) ||
      (s === !0
        ? (r[o] = Ph(l))
        : typeof s == 'object' && (r[o] = os(s, t.atField(o))))
  }
  return r
}
a(Sh, 'createExplicitSelection')
function Ph(e) {
  return e?.kind === 'object'
    ? { selection: { $composites: !0, $scalars: !0 } }
    : !0
}
a(Ph, 'defaultSelectionForField')
function Tc(e) {
  if (e === null) return null
  if (typeof e == 'string' || typeof e == 'number' || typeof e == 'boolean')
    return e
  if (typeof e == 'bigint') return { $type: 'BigInt', value: String(e) }
  if (Ch(e)) return { $type: 'DateTime', value: e.toISOString() }
  if (Fn(e)) return { $type: 'FieldRef', value: { _ref: e.name } }
  if (Array.isArray(e)) return _h(e)
  if (ArrayBuffer.isView(e))
    return { $type: 'Bytes', value: Buffer.from(e).toString('base64') }
  if (Oh(e)) return e.values
  if (Xe(e)) return { $type: 'Decimal', value: e.toFixed() }
  if (e instanceof Y) {
    if (e !== Rt.instances[e._getName()])
      throw new Error('Invalid ObjectEnumValue')
    return { $type: 'Enum', value: e._getName() }
  }
  if (typeof e == 'object') return Ac(e)
  Ge(e, 'Unknown value type')
}
a(Tc, 'serializeArgumentsValue')
function Ac(e) {
  if (e.$type) return { $type: 'Json', value: JSON.stringify(e) }
  let t = {}
  for (let r in e) {
    let n = e[r]
    n !== void 0 && (t[r] = Tc(n))
  }
  return t
}
a(Ac, 'serializeArgumentsObject')
function _h(e) {
  let t = []
  for (let r of e) r !== void 0 && t.push(Tc(r))
  return t
}
a(_h, 'serializeArgumentsArray')
function Ch(e) {
  return Object.prototype.toString.call(e) === '[object Date]'
}
a(Ch, 'isDate')
function Oh(e) {
  return typeof e == 'object' && e !== null && e.__prismaRawParameters__ === !0
}
a(Oh, 'isRawParameters')
var ir = class {
  constructor(t) {
    this.params = t
    this.params.modelName &&
      (this.model = this.params.baseDmmf.modelMap[this.params.modelName])
  }
  throwValidationError(t) {
    Ri({
      errors: [t],
      originalMethod: this.params.originalMethod,
      args: this.params.rootArgs ?? {},
      callsite: this.params.callsite,
      errorFormat: this.params.errorFormat,
    })
  }
  getSelectionPath() {
    return this.params.path
  }
  getOutputTypeDescription() {
    if (!!this.model)
      return {
        name: this.model.name,
        fields: this.model.fields.map((t) => ({
          name: t.name,
          typeName: 'boolean',
          isRelation: t.kind === 'object',
        })),
      }
  }
  isRawAction() {
    return [
      'executeRaw',
      'queryRaw',
      'runCommandRaw',
      'findRaw',
      'aggregateRaw',
    ].includes(this.params.action)
  }
  getComputedFields() {
    if (!!this.model)
      return this.params.extensions.getAllComputedFields(this.model.name)
  }
  findField(t) {
    return this.model?.fields.find((r) => r.name === t)
  }
  atField(t) {
    let r = this.findField(t),
      n = r?.kind === 'object' ? r.type : void 0
    return new ir({
      ...this.params,
      modelName: n,
      path: this.params.path.concat(t),
    })
  }
}
a(ir, 'SerializeContext')
var or = class {
  constructor(t, r) {
    this.baseDmmf = t
    this.errorFormat = r
  }
  createMessage(t) {
    let r = vc({ ...t, baseDmmf: this.baseDmmf, errorFormat: this.errorFormat })
    return new un(r)
  }
  createBatch(t) {
    return t.map((r) => r.toEngineQuery())
  }
}
a(or, 'JsonProtocolEncoder')
var Mh = {
    aggregate: !1,
    aggregateRaw: !1,
    createMany: !0,
    createOne: !0,
    deleteMany: !0,
    deleteOne: !0,
    executeRaw: !0,
    findFirst: !1,
    findFirstOrThrow: !1,
    findMany: !1,
    findRaw: !1,
    findUnique: !1,
    findUniqueOrThrow: !1,
    groupBy: !1,
    queryRaw: !1,
    runCommandRaw: !0,
    updateMany: !0,
    updateOne: !0,
    upsertOne: !0,
  },
  un = class {
    constructor(t) {
      this.query = t
    }
    isWrite() {
      return Mh[this.query.action]
    }
    getBatchId() {
      if (this.query.action !== 'findUnique') return
      let t = []
      return (
        this.query.modelName && t.push(this.query.modelName),
        this.query.query.arguments && t.push(ss(this.query.query.arguments)),
        t.push(ss(this.query.query.selection)),
        t.join('')
      )
    }
    toDebugString() {
      return JSON.stringify(this.query, null, 2)
    }
    toEngineQuery() {
      return this.query
    }
    deserializeResponse(t, r) {
      if (!t) return t
      let n = Object.values(t)[0],
        i = r.filter((o) => o !== 'select' && o !== 'include')
      return _i(Yr(n, i))
    }
  }
a(un, 'JsonProtocolMessage')
function ss(e) {
  return `(${Object.keys(e)
    .sort()
    .map((r) => {
      let n = e[r]
      return typeof n == 'object' && n !== null ? `(${r} ${ss(n)})` : r
    })
    .join(' ')})`
}
a(ss, 'buildKeysString')
var he = class {
  constructor(t, r) {
    if (t.length - 1 !== r.length)
      throw t.length === 0
        ? new TypeError('Expected at least 1 string')
        : new TypeError(
            `Expected ${t.length} strings to have ${t.length - 1} values`
          )
    let n = r.reduce((s, l) => s + (l instanceof he ? l.values.length : 1), 0)
    ;(this.values = new Array(n)),
      (this.strings = new Array(n + 1)),
      (this.strings[0] = t[0])
    let i = 0,
      o = 0
    for (; i < r.length; ) {
      let s = r[i++],
        l = t[i]
      if (s instanceof he) {
        this.strings[o] += s.strings[0]
        let u = 0
        for (; u < s.values.length; )
          (this.values[o++] = s.values[u++]), (this.strings[o] = s.strings[u])
        this.strings[o] += l
      } else (this.values[o++] = s), (this.strings[o] = l)
    }
  }
  get text() {
    let t = 1,
      r = this.strings[0]
    for (; t < this.strings.length; ) r += `$${t}${this.strings[t++]}`
    return r
  }
  get sql() {
    let t = 1,
      r = this.strings[0]
    for (; t < this.strings.length; ) r += `?${this.strings[t++]}`
    return r
  }
  inspect() {
    return { text: this.text, sql: this.sql, values: this.values }
  }
}
a(he, 'Sql')
function Sc(e, t = ',', r = '', n = '') {
  if (e.length === 0)
    throw new TypeError(
      'Expected `join([])` to be called with an array of multiple elements, but got an empty array'
    )
  return new he([r, ...Array(e.length - 1).fill(t), n], e)
}
a(Sc, 'join')
function as(e) {
  return new he([e], [])
}
a(as, 'raw')
var Pc = as('')
function ls(e, ...t) {
  return new he(e, t)
}
a(ls, 'sql')
var us = a(
  (e) => e.reduce((t, r, n) => `${t}@P${n}${r}`),
  'mssqlPreparedStatement'
)
function sr(e) {
  try {
    return _c(e, 'fast')
  } catch {
    return _c(e, 'slow')
  }
}
a(sr, 'serializeRawParameters')
function _c(e, t) {
  return JSON.stringify(e.map((r) => Nh(r, t)))
}
a(_c, 'serializeRawParametersInternal')
function Nh(e, t) {
  return typeof e == 'bigint'
    ? { prisma__type: 'bigint', prisma__value: e.toString() }
    : Rh(e)
    ? { prisma__type: 'date', prisma__value: e.toJSON() }
    : ye.isDecimal(e)
    ? { prisma__type: 'decimal', prisma__value: e.toJSON() }
    : Buffer.isBuffer(e)
    ? { prisma__type: 'bytes', prisma__value: e.toString('base64') }
    : Fh(e) || ArrayBuffer.isView(e)
    ? {
        prisma__type: 'bytes',
        prisma__value: Buffer.from(e).toString('base64'),
      }
    : typeof e == 'object' && t === 'slow'
    ? Oc(e)
    : e
}
a(Nh, 'encodeParameter')
function Rh(e) {
  return e instanceof Date
    ? !0
    : Object.prototype.toString.call(e) === '[object Date]' &&
        typeof e.toJSON == 'function'
}
a(Rh, 'isDate')
function Fh(e) {
  return e instanceof ArrayBuffer || e instanceof SharedArrayBuffer
    ? !0
    : typeof e == 'object' && e !== null
    ? e[Symbol.toStringTag] === 'ArrayBuffer' ||
      e[Symbol.toStringTag] === 'SharedArrayBuffer'
    : !1
}
a(Fh, 'isArrayBufferLike')
function Oc(e) {
  if (typeof e != 'object' || e === null) return e
  if (typeof e.toJSON == 'function') return e.toJSON()
  if (Array.isArray(e)) return e.map(Cc)
  let t = {}
  for (let r of Object.keys(e)) t[r] = Cc(e[r])
  return t
}
a(Oc, 'preprocessObject')
function Cc(e) {
  return typeof e == 'bigint' ? e.toString() : Oc(e)
}
a(Cc, 'preprocessValueInObject')
var Ih = /^(\s*alter\s)/i,
  Mc = U('prisma:client')
function cs(e, t, r) {
  if (t.length > 0 && Ih.exec(e))
    throw new Error(`Running ALTER using ${r} is not supported
Using the example below you can still execute your query with Prisma, but please note that it is vulnerable to SQL injection attacks and requires you to take care of input sanitization.

Example:
  await prisma.$executeRawUnsafe(\`ALTER USER prisma WITH PASSWORD '\${password}'\`)

More Information: https://pris.ly/d/execute-raw
`)
}
a(cs, 'checkAlter')
function Dh(e) {
  return Array.isArray(e)
}
a(Dh, 'isReadonlyArray')
var ps = a(
  (e, t) =>
    ([r, ...n]) => {
      let i = '',
        o
      if (typeof r == 'string')
        (i = r),
          (o = { values: sr(n || []), __prismaRawParameters__: !0 }),
          t.includes('executeRaw') &&
            cs(i, n, 'prisma.$executeRawUnsafe(<SQL>, [...values])')
      else if (Dh(r))
        switch (e._activeProvider) {
          case 'sqlite':
          case 'mysql': {
            let s = new he(r, n)
            ;(i = s.sql),
              (o = { values: sr(s.values), __prismaRawParameters__: !0 })
            break
          }
          case 'cockroachdb':
          case 'postgresql': {
            let s = new he(r, n)
            ;(i = s.text),
              t.includes('executeRaw') &&
                cs(i, s.values, 'prisma.$executeRaw`<SQL>`'),
              (o = { values: sr(s.values), __prismaRawParameters__: !0 })
            break
          }
          case 'sqlserver': {
            ;(i = us(r)), (o = { values: sr(n), __prismaRawParameters__: !0 })
            break
          }
          default:
            throw new Error(
              `The ${e._activeProvider} provider does not support ${t}`
            )
        }
      else {
        switch (e._activeProvider) {
          case 'sqlite':
          case 'mysql':
            i = r.sql
            break
          case 'cockroachdb':
          case 'postgresql':
            ;(i = r.text),
              t.includes('executeRaw') &&
                cs(i, r.values, 'prisma.$executeRaw(sql`<SQL>`)')
            break
          case 'sqlserver':
            i = us(r.strings)
            break
          default:
            throw new Error(
              `The ${e._activeProvider} provider does not support ${t}`
            )
        }
        o = { values: sr(r.values), __prismaRawParameters__: !0 }
      }
      return (
        o?.values
          ? Mc(`prisma.${t}(${i}, ${o.values})`)
          : Mc(`prisma.${t}(${i})`),
        { query: i, parameters: o }
      )
    },
  'rawQueryArgsMapper'
)
function Nc(e, t = () => {}) {
  let r,
    n = new Promise((i) => (r = i))
  return {
    then(i) {
      return --e === 0 && r(t()), i?.(n)
    },
  }
}
a(Nc, 'getLockCountPromise')
function Rc(e) {
  return typeof e == 'string'
    ? e
    : e.reduce((t, r) => {
        let n = typeof r == 'string' ? r : r.level
        return n === 'query'
          ? t
          : t && (r === 'info' || t === 'info')
          ? 'info'
          : n
      }, void 0)
}
a(Rc, 'getLogLevel')
function Ic(e, t, r) {
  let n = Fc(e, r),
    i = Fc(t, r),
    o = Object.values(i).map((l) => l[l.length - 1]),
    s = Object.keys(i)
  return (
    Object.entries(n).forEach(([l, u]) => {
      s.includes(l) || o.push(u[u.length - 1])
    }),
    o
  )
}
a(Ic, 'mergeBy')
var Fc = a(
  (e, t) =>
    e.reduce((r, n) => {
      let i = t(n)
      return r[i] || (r[i] = []), r[i].push(n), r
    }, {}),
  'groupBy'
)
var cn = class {
  constructor() {
    this._middlewares = []
  }
  use(t) {
    this._middlewares.push(t)
  }
  get(t) {
    return this._middlewares[t]
  }
  has(t) {
    return !!this._middlewares[t]
  }
  length() {
    return this._middlewares.length
  }
}
a(cn, 'MiddlewareHandler')
var $c = O(Rr())
function Dc({ result: e, modelName: t, select: r, extensions: n }) {
  let i = n.getAllComputedFields(t)
  if (!i) return e
  let o = [],
    s = []
  for (let l of Object.values(i)) {
    if (r) {
      if (!r[l.name]) continue
      let u = l.needs.filter((c) => !r[c])
      u.length > 0 && s.push(es(u))
    }
    kh(e, l.needs) && o.push($h(l, ft(e, o)))
  }
  return o.length > 0 || s.length > 0 ? ft(e, [...o, ...s]) : e
}
a(Dc, 'applyResultExtensions')
function kh(e, t) {
  return t.every((r) => jo(e, r))
}
a(kh, 'areNeedsMet')
function $h(e, t) {
  return vt(pt(e.name, () => e.compute(t)))
}
a($h, 'computedPropertyLayer')
function Fi({ visitor: e, result: t, args: r, dmmf: n, model: i }) {
  if (Array.isArray(t)) {
    for (let s = 0; s < t.length; s++)
      t[s] = Fi({ result: t[s], args: r, model: i, dmmf: n, visitor: e })
    return t
  }
  let o = e(t, i, r) ?? t
  return (
    r.include &&
      kc({
        includeOrSelect: r.include,
        result: o,
        parentModel: i,
        dmmf: n,
        visitor: e,
      }),
    r.select &&
      kc({
        includeOrSelect: r.select,
        result: o,
        parentModel: i,
        dmmf: n,
        visitor: e,
      }),
    o
  )
}
a(Fi, 'visitQueryResult')
function kc({
  includeOrSelect: e,
  result: t,
  parentModel: r,
  dmmf: n,
  visitor: i,
}) {
  for (let [o, s] of Object.entries(e)) {
    if (!s || t[o] == null) continue
    let l = r.fields.find((c) => c.name === o)
    if (!l || l.kind !== 'object' || !l.relationName) continue
    let u = typeof s == 'object' ? s : {}
    t[o] = Fi({
      visitor: i,
      result: t[o],
      args: u,
      model: n.getModelMap()[l.type],
      dmmf: n,
    })
  }
}
a(kc, 'visitNested')
var pn = class {
  constructor(t) {
    this.options = t
    this.tickActive = !1
    this.batches = {}
  }
  request(t) {
    let r = this.options.batchBy(t)
    return r
      ? (this.batches[r] ||
          ((this.batches[r] = []),
          this.tickActive ||
            ((this.tickActive = !0),
            process.nextTick(() => {
              this.dispatchBatches(), (this.tickActive = !1)
            }))),
        new Promise((n, i) => {
          this.batches[r].push({ request: t, resolve: n, reject: i })
        }))
      : this.options.singleLoader(t)
  }
  dispatchBatches() {
    for (let t in this.batches) {
      let r = this.batches[t]
      delete this.batches[t],
        r.length === 1
          ? this.options
              .singleLoader(r[0].request)
              .then((n) => {
                n instanceof Error ? r[0].reject(n) : r[0].resolve(n)
              })
              .catch((n) => {
                r[0].reject(n)
              })
          : this.options
              .batchLoader(r.map((n) => n.request))
              .then((n) => {
                if (n instanceof Error)
                  for (let i = 0; i < r.length; i++) r[i].reject(n)
                else
                  for (let i = 0; i < r.length; i++) {
                    let o = n[i]
                    o instanceof Error ? r[i].reject(o) : r[i].resolve(o)
                  }
              })
              .catch((n) => {
                for (let i = 0; i < r.length; i++) r[i].reject(n)
              })
    }
  }
  get [Symbol.toStringTag]() {
    return 'DataLoader'
  }
}
a(pn, 'DataLoader')
var Lh = U('prisma:client:request_handler'),
  fn = class {
    constructor(t, r) {
      ;(this.logEmitter = r),
        (this.client = t),
        (this.dataloader = new pn({
          batchLoader: (n) => {
            let i = n[0].transaction,
              s = n[0].protocolEncoder.createBatch(
                n.map((c) => c.protocolMessage)
              ),
              l = De({
                context: n[0].otelParentCtx,
                tracingConfig: t._tracingConfig,
              }),
              u = n.some((c) => c.protocolMessage.isWrite())
            return this.client._engine.requestBatch(s, {
              traceparent: l,
              transaction: jh(i),
              containsWrite: u,
              customDataProxyFetch: n[0].customDataProxyFetch,
            })
          },
          singleLoader: (n) => {
            let i = n.transaction?.kind === 'itx' ? Lc(n.transaction) : void 0
            return this.client._engine.request(
              n.protocolMessage.toEngineQuery(),
              {
                traceparent: De({ tracingConfig: n.tracingConfig }),
                interactiveTransaction: i,
                isWrite: n.protocolMessage.isWrite(),
                customDataProxyFetch: n.customDataProxyFetch,
              }
            )
          },
          batchBy: (n) =>
            n.transaction?.id
              ? `transaction-${n.transaction.id}`
              : n.protocolMessage.getBatchId(),
        }))
    }
    async request({
      protocolMessage: t,
      protocolEncoder: r,
      dataPath: n = [],
      callsite: i,
      modelName: o,
      rejectOnNotFound: s,
      clientMethod: l,
      args: u,
      transaction: c,
      unpacker: p,
      extensions: f,
      otelParentCtx: d,
      otelChildCtx: m,
      customDataProxyFetch: h,
    }) {
      try {
        let g = await this.dataloader.request({
            protocolMessage: t,
            protocolEncoder: r,
            transaction: c,
            otelParentCtx: d,
            otelChildCtx: m,
            tracingConfig: this.client._tracingConfig,
            customDataProxyFetch: h,
          }),
          b = g?.data,
          y = g?.elapsed,
          x = this.unpack(t, b, n, p)
        return (
          nc(x, l, o, s),
          o &&
            (x = this.applyResultExtensions({
              result: x,
              modelName: o,
              args: u,
              extensions: f,
            })),
          process.env.PRISMA_CLIENT_GET_TIME ? { data: x, elapsed: y } : x
        )
      } catch (g) {
        this.handleAndLogRequestError({
          error: g,
          clientMethod: l,
          callsite: i,
          transaction: c,
          args: u,
        })
      }
    }
    handleAndLogRequestError(t) {
      try {
        this.handleRequestError(t)
      } catch (r) {
        throw (
          (this.logEmitter &&
            this.logEmitter.emit('error', {
              message: r.message,
              target: t.clientMethod,
              timestamp: new Date(),
            }),
          r)
        )
      }
    }
    handleRequestError({
      error: t,
      clientMethod: r,
      callsite: n,
      transaction: i,
      args: o,
    }) {
      if ((Lh(t), Bh(t, i) || t instanceof Pe)) throw t
      if (t instanceof X && qh(t)) {
        let l = jc(t.meta)
        Ri({
          args: o,
          errors: [l],
          callsite: n,
          errorFormat: this.client._errorFormat,
          originalMethod: r,
        })
      }
      let s = t.message
      throw (
        (n &&
          (s = ct({
            callsite: n,
            originalMethod: r,
            isPanic: t.isPanic,
            showColors: this.client._errorFormat === 'pretty',
            message: s,
          })),
        (s = this.sanitizeMessage(s)),
        t.code
          ? new X(s, {
              code: t.code,
              clientVersion: this.client._clientVersion,
              meta: t.meta,
              batchRequestIdx: t.batchRequestIdx,
            })
          : t.isPanic
          ? new fe(s, this.client._clientVersion)
          : t instanceof Z
          ? new Z(s, {
              clientVersion: this.client._clientVersion,
              batchRequestIdx: t.batchRequestIdx,
            })
          : t instanceof G
          ? new G(s, this.client._clientVersion)
          : t instanceof fe
          ? new fe(s, this.client._clientVersion)
          : ((t.clientVersion = this.client._clientVersion), t))
      )
    }
    sanitizeMessage(t) {
      return this.client._errorFormat && this.client._errorFormat !== 'pretty'
        ? (0, $c.default)(t)
        : t
    }
    unpack(t, r, n, i) {
      if (!r) return r
      r.data && (r = r.data)
      let o = t.deserializeResponse(r, n)
      return i ? i(o) : o
    }
    applyResultExtensions({ result: t, modelName: r, args: n, extensions: i }) {
      if (i.isEmpty() || t == null) return t
      let o = this.client._baseDmmf.getModelMap()[r]
      return o
        ? Fi({
            result: t,
            args: n ?? {},
            model: o,
            dmmf: this.client._baseDmmf,
            visitor(s, l, u) {
              let c = Te(l.name)
              return Dc({
                result: s,
                modelName: c,
                select: u.select,
                extensions: i,
              })
            },
          })
        : t
    }
    get [Symbol.toStringTag]() {
      return 'RequestHandler'
    }
  }
a(fn, 'RequestHandler')
function jh(e) {
  if (!!e) {
    if (e.kind === 'batch')
      return { kind: 'batch', options: { isolationLevel: e.isolationLevel } }
    if (e.kind === 'itx') return { kind: 'itx', options: Lc(e) }
    Ge(e, 'Unknown transaction kind')
  }
}
a(jh, 'getTransactionOptions')
function Lc(e) {
  return { id: e.id, payload: e.payload }
}
a(Lc, 'getItxTransactionOptions')
function Bh(e, t) {
  return Br(e) && t?.kind === 'batch' && e.batchRequestIdx !== t.index
}
a(Bh, 'isMismatchingBatchIndex')
function qh(e) {
  return e.code === 'P2009' || e.code === 'P2012'
}
a(qh, 'isValidationError')
function jc(e) {
  if (e.kind === 'Union') return { kind: 'Union', errors: e.errors.map(jc) }
  if (Array.isArray(e.selectionPath)) {
    let [, ...t] = e.selectionPath
    return { ...e, selectionPath: t }
  }
  return e
}
a(jc, 'convertValidationError')
function Bc(e) {
  return e.map((t) => {
    let r = {}
    for (let n of Object.keys(t)) r[n] = qc(t[n])
    return r
  })
}
a(Bc, 'deserializeRawResults')
function qc({ prisma__type: e, prisma__value: t }) {
  switch (e) {
    case 'bigint':
      return BigInt(t)
    case 'bytes':
      return Buffer.from(t, 'base64')
    case 'decimal':
      return new ye(t)
    case 'datetime':
    case 'date':
      return new Date(t)
    case 'time':
      return new Date(`1970-01-01T${t}Z`)
    case 'array':
      return t.map(qc)
    default:
      return t
  }
}
a(qc, 'deserializeValue')
var Qc = O(Rn())
var Vc = [
    'datasources',
    'errorFormat',
    'log',
    '__internal',
    'rejectOnNotFound',
  ],
  Uc = ['pretty', 'colorless', 'minimal'],
  Gc = ['info', 'query', 'warn', 'error'],
  Vh = {
    datasources: (e, t) => {
      if (!!e) {
        if (typeof e != 'object' || Array.isArray(e))
          throw new K(
            `Invalid value ${JSON.stringify(
              e
            )} for "datasources" provided to PrismaClient constructor`
          )
        for (let [r, n] of Object.entries(e)) {
          if (!t.includes(r)) {
            let i = ar(r, t) || `Available datasources: ${t.join(', ')}`
            throw new K(
              `Unknown datasource ${r} provided to PrismaClient constructor.${i}`
            )
          }
          if (typeof n != 'object' || Array.isArray(n))
            throw new K(`Invalid value ${JSON.stringify(
              e
            )} for datasource "${r}" provided to PrismaClient constructor.
It should have this form: { url: "CONNECTION_STRING" }`)
          if (n && typeof n == 'object')
            for (let [i, o] of Object.entries(n)) {
              if (i !== 'url')
                throw new K(`Invalid value ${JSON.stringify(
                  e
                )} for datasource "${r}" provided to PrismaClient constructor.
It should have this form: { url: "CONNECTION_STRING" }`)
              if (typeof o != 'string')
                throw new K(`Invalid value ${JSON.stringify(
                  o
                )} for datasource "${r}" provided to PrismaClient constructor.
It should have this form: { url: "CONNECTION_STRING" }`)
            }
        }
      }
    },
    errorFormat: (e) => {
      if (!!e) {
        if (typeof e != 'string')
          throw new K(
            `Invalid value ${JSON.stringify(
              e
            )} for "errorFormat" provided to PrismaClient constructor.`
          )
        if (!Uc.includes(e)) {
          let t = ar(e, Uc)
          throw new K(
            `Invalid errorFormat ${e} provided to PrismaClient constructor.${t}`
          )
        }
      }
    },
    log: (e) => {
      if (!e) return
      if (!Array.isArray(e))
        throw new K(
          `Invalid value ${JSON.stringify(
            e
          )} for "log" provided to PrismaClient constructor.`
        )
      function t(r) {
        if (typeof r == 'string' && !Gc.includes(r)) {
          let n = ar(r, Gc)
          throw new K(
            `Invalid log level "${r}" provided to PrismaClient constructor.${n}`
          )
        }
      }
      a(t, 'validateLogLevel')
      for (let r of e) {
        t(r)
        let n = {
          level: t,
          emit: (i) => {
            let o = ['stdout', 'event']
            if (!o.includes(i)) {
              let s = ar(i, o)
              throw new K(
                `Invalid value ${JSON.stringify(
                  i
                )} for "emit" in logLevel provided to PrismaClient constructor.${s}`
              )
            }
          },
        }
        if (r && typeof r == 'object')
          for (let [i, o] of Object.entries(r))
            if (n[i]) n[i](o)
            else
              throw new K(
                `Invalid property ${i} for "log" provided to PrismaClient constructor`
              )
      }
    },
    __internal: (e) => {
      if (!e) return
      let t = ['debug', 'hooks', 'engine', 'measurePerformance']
      if (typeof e != 'object')
        throw new K(
          `Invalid value ${JSON.stringify(
            e
          )} for "__internal" to PrismaClient constructor`
        )
      for (let [r] of Object.entries(e))
        if (!t.includes(r)) {
          let n = ar(r, t)
          throw new K(
            `Invalid property ${JSON.stringify(
              r
            )} for "__internal" provided to PrismaClient constructor.${n}`
          )
        }
    },
    rejectOnNotFound: (e) => {
      if (!!e) {
        if (
          Qr(e) ||
          typeof e == 'boolean' ||
          typeof e == 'object' ||
          typeof e == 'function'
        )
          return e
        throw new K(
          `Invalid rejectOnNotFound expected a boolean/Error/{[modelName: Error | boolean]} but received ${JSON.stringify(
            e
          )}`
        )
      }
    },
  }
function Kc(e, t) {
  for (let [r, n] of Object.entries(e)) {
    if (!Vc.includes(r)) {
      let i = ar(r, Vc)
      throw new K(
        `Unknown property ${r} provided to PrismaClient constructor.${i}`
      )
    }
    Vh[r](n, t)
  }
}
a(Kc, 'validatePrismaClientOptions')
function ar(e, t) {
  if (t.length === 0 || typeof e != 'string') return ''
  let r = Uh(e, t)
  return r ? ` Did you mean "${r}"?` : ''
}
a(ar, 'getDidYouMean')
function Uh(e, t) {
  if (t.length === 0) return null
  let r = t.map((i) => ({ value: i, distance: (0, Qc.default)(e, i) }))
  r.sort((i, o) => (i.distance < o.distance ? -1 : 1))
  let n = r[0]
  return n.distance < 3 ? n.value : null
}
a(Uh, 'getAlternative')
function Wc(e) {
  return e.length === 0
    ? Promise.resolve([])
    : new Promise((t, r) => {
        let n = new Array(e.length),
          i = null,
          o = !1,
          s = 0,
          l = a(() => {
            o || (s++, s === e.length && ((o = !0), i ? r(i) : t(n)))
          }, 'settleOnePromise'),
          u = a((c) => {
            o || ((o = !0), r(c))
          }, 'immediatelyReject')
        for (let c = 0; c < e.length; c++)
          e[c].then(
            (p) => {
              ;(n[c] = p), l()
            },
            (p) => {
              if (!Br(p)) {
                u(p)
                return
              }
              p.batchRequestIdx === c ? u(p) : (i || (i = p), l())
            }
          )
      })
}
a(Wc, 'waitForBatch')
var Re = U('prisma:client')
typeof globalThis == 'object' && (globalThis.NODE_CLIENT = !0)
var Gh = Symbol.for('prisma.client.transaction.id'),
  Qh = {
    id: 0,
    nextId() {
      return ++this.id
    },
  }
function Xc(e) {
  class t {
    constructor(n) {
      this._middlewares = new cn()
      this._getDmmf = li(async (n) => {
        try {
          let i = await me(
            {
              name: 'getDmmf',
              enabled: this._tracingConfig.enabled,
              internal: !0,
            },
            () => this._engine.getDmmf()
          )
          return me(
            {
              name: 'processDmmf',
              enabled: this._tracingConfig.enabled,
              internal: !0,
            },
            () => new qe(mu(i))
          )
        } catch (i) {
          this._fetcher.handleAndLogRequestError({ ...n, args: {}, error: i })
        }
      })
      this._getProtocolEncoder = li(async (n) =>
        this._engineConfig.engineProtocol === 'json'
          ? new or(this._baseDmmf, this._errorFormat)
          : (this._dmmf === void 0 && (this._dmmf = await this._getDmmf(n)),
            new rn(this._dmmf, this._errorFormat))
      )
      this.$extends = ac
      n && Kc(n, e.datasourceNames)
      let i = new Yc.EventEmitter().on('error', (l) => {})
      ;(this._extensions = Qe.empty()),
        (this._previewFeatures = e.generator?.previewFeatures ?? []),
        (this._rejectOnNotFound = n?.rejectOnNotFound),
        (this._clientVersion = e.clientVersion ?? Ai),
        (this._activeProvider = e.activeProvider),
        (this._dataProxy = e.dataProxy),
        (this._tracingConfig = Oo(this._previewFeatures)),
        (this._clientEngineType = Io(e.generator))
      let o = {
          rootEnvPath:
            e.relativeEnvPaths.rootEnvPath &&
            dn.default.resolve(e.dirname, e.relativeEnvPaths.rootEnvPath),
          schemaEnvPath:
            e.relativeEnvPaths.schemaEnvPath &&
            dn.default.resolve(e.dirname, e.relativeEnvPaths.schemaEnvPath),
        },
        s = Ur(o, { conflictCheck: 'none' })
      try {
        let l = n ?? {},
          u = l.__internal ?? {},
          c = u.debug === !0
        c && U.enable('prisma:client')
        let p = dn.default.resolve(e.dirname, e.relativePath)
        zc.default.existsSync(p) || (p = e.dirname),
          Re('dirname', e.dirname),
          Re('relativePath', e.relativePath),
          Re('cwd', p)
        let f = l.datasources || {},
          d = Object.entries(f)
            .filter(([b, y]) => y && y.url)
            .map(([b, { url: y }]) => ({ name: b, url: y })),
          m = Ic([], d, (b) => b.name),
          h = u.engine || {}
        l.errorFormat
          ? (this._errorFormat = l.errorFormat)
          : process.env.NODE_ENV === 'production'
          ? (this._errorFormat = 'minimal')
          : process.env.NO_COLOR
          ? (this._errorFormat = 'colorless')
          : (this._errorFormat = 'colorless'),
          (this._baseDmmf = new et(e.document))
        let g = $o(e.generator)
        if ((Re('protocol', g), this._dataProxy && g === 'graphql')) {
          let b = e.document
          this._dmmf = new qe(b)
        }
        if (
          ((this._engineConfig = {
            cwd: p,
            dirname: e.dirname,
            enableDebugLogs: c,
            allowTriggerPanic: h.allowTriggerPanic,
            datamodelPath: dn.default.join(
              e.dirname,
              e.filename ?? 'schema.prisma'
            ),
            prismaPath: h.binaryPath ?? void 0,
            engineEndpoint: h.endpoint,
            datasources: m,
            generator: e.generator,
            showColors: this._errorFormat === 'pretty',
            logLevel: l.log && Rc(l.log),
            logQueries:
              l.log &&
              Boolean(
                typeof l.log == 'string'
                  ? l.log === 'query'
                  : l.log.find((b) =>
                      typeof b == 'string' ? b === 'query' : b.level === 'query'
                    )
              ),
            env: s?.parsed ?? e.injectableEdgeEnv?.parsed ?? {},
            flags: [],
            clientVersion: e.clientVersion,
            previewFeatures: this._previewFeatures,
            activeProvider: e.activeProvider,
            inlineSchema: e.inlineSchema,
            inlineDatasources: e.inlineDatasources,
            inlineSchemaHash: e.inlineSchemaHash,
            tracingConfig: this._tracingConfig,
            logEmitter: i,
            engineProtocol: g,
          }),
          Re('clientVersion', e.clientVersion),
          Re(
            'clientEngineType',
            this._dataProxy ? 'dataproxy' : this._clientEngineType
          ),
          this._dataProxy && Re('using Data Proxy with Node.js runtime'),
          (this._engine = this.getEngine()),
          (this._fetcher = new fn(this, i)),
          l.log)
        )
          for (let b of l.log) {
            let y =
              typeof b == 'string' ? b : b.emit === 'stdout' ? b.level : null
            y &&
              this.$on(y, (x) => {
                Jr.log(`${Jr.tags[y] ?? ''}`, x.message || x.query)
              })
          }
        this._metrics = new mt(this._engine)
      } catch (l) {
        throw ((l.clientVersion = this._clientVersion), l)
      }
      return Si(this)
    }
    get [Symbol.toStringTag]() {
      return 'PrismaClient'
    }
    getEngine() {
      if ((this._dataProxy, this._clientEngineType === 'library'))
        return new zt(this._engineConfig)
      throw (
        (this._clientEngineType,
        'binary',
        new J('Invalid client engine type, please use `library` or `binary`'))
      )
    }
    $use(n) {
      this._middlewares.use(n)
    }
    $on(n, i) {
      n === 'beforeExit'
        ? this._engine.on('beforeExit', i)
        : this._engine.on(n, (o) => {
            let s = o.fields
            return i(
              n === 'query'
                ? {
                    timestamp: o.timestamp,
                    query: s?.query ?? o.query,
                    params: s?.params ?? o.params,
                    duration: s?.duration_ms ?? o.duration,
                    target: o.target,
                  }
                : {
                    timestamp: o.timestamp,
                    message: s?.message ?? o.message,
                    target: o.target,
                  }
            )
          })
    }
    $connect() {
      try {
        return this._engine.start()
      } catch (n) {
        throw ((n.clientVersion = this._clientVersion), n)
      }
    }
    async _runDisconnect() {
      await this._engine.stop(),
        delete this._connectionPromise,
        (this._engine = this.getEngine()),
        delete this._disconnectionPromise
    }
    async $disconnect() {
      try {
        await this._engine.stop()
      } catch (n) {
        throw ((n.clientVersion = this._clientVersion), n)
      } finally {
        Sa(), this._dataProxy || (this._dmmf = void 0)
      }
    }
    $executeRawInternal(n, i, o) {
      return this._request({
        action: 'executeRaw',
        args: o,
        transaction: n,
        clientMethod: i,
        argsMapper: ps(this, i),
        callsite: dt(this._errorFormat),
        dataPath: [],
      })
    }
    $executeRaw(n, ...i) {
      return $e((o) => {
        if (n.raw !== void 0 || n.sql !== void 0)
          return this.$executeRawInternal(o, '$executeRaw', [n, ...i])
        throw new J(
          "`$executeRaw` is a tag function, please use it like the following:\n```\nconst result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`\n```\n\nOr read our docs at https://www.prisma.io/docs/concepts/components/prisma-client/raw-database-access#executeraw\n"
        )
      })
    }
    $executeRawUnsafe(n, ...i) {
      return $e((o) =>
        this.$executeRawInternal(o, '$executeRawUnsafe', [n, ...i])
      )
    }
    $runCommandRaw(n) {
      if (e.activeProvider !== 'mongodb')
        throw new J(
          `The ${e.activeProvider} provider does not support $runCommandRaw. Use the mongodb provider.`
        )
      return $e((i) =>
        this._request({
          args: { command: n },
          clientMethod: '$runCommandRaw',
          dataPath: [],
          action: 'runCommandRaw',
          callsite: dt(this._errorFormat),
          transaction: i,
        })
      )
    }
    async $queryRawInternal(n, i, o) {
      return this._request({
        action: 'queryRaw',
        args: o,
        transaction: n,
        clientMethod: i,
        argsMapper: ps(this, i),
        callsite: dt(this._errorFormat),
        dataPath: [],
      }).then(Bc)
    }
    $queryRaw(n, ...i) {
      return $e((o) => {
        if (n.raw !== void 0 || n.sql !== void 0)
          return this.$queryRawInternal(o, '$queryRaw', [n, ...i])
        throw new J(
          "`$queryRaw` is a tag function, please use it like the following:\n```\nconst result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`\n```\n\nOr read our docs at https://www.prisma.io/docs/concepts/components/prisma-client/raw-database-access#queryraw\n"
        )
      })
    }
    $queryRawUnsafe(n, ...i) {
      return $e((o) => this.$queryRawInternal(o, '$queryRawUnsafe', [n, ...i]))
    }
    _transactionWithArray({ promises: n, options: i }) {
      let o = Qh.nextId(),
        s = Nc(n.length),
        l = n.map((u, c) => {
          if (u?.[Symbol.toStringTag] !== 'PrismaPromise')
            throw new Error(
              'All elements of the array need to be Prisma Client promises. Hint: Please make sure you are not awaiting the Prisma client calls you intended to pass in the $transaction function.'
            )
          let p = i?.isolationLevel,
            f = { kind: 'batch', id: o, index: c, isolationLevel: p, lock: s }
          return u.requestTransaction?.(f) ?? u
        })
      return Wc(l)
    }
    async _transactionWithCallback({ callback: n, options: i }) {
      let o = { traceparent: De({ tracingConfig: this._tracingConfig }) },
        s = await this._engine.transaction('start', o, i),
        l
      try {
        let u = { kind: 'itx', ...s }
        ;(l = await n(fs(this, u))),
          await this._engine.transaction('commit', o, s)
      } catch (u) {
        throw (
          (await this._engine.transaction('rollback', o, s).catch(() => {}), u)
        )
      }
      return l
    }
    $transaction(n, i) {
      let o
      typeof n == 'function'
        ? (o = a(
            () => this._transactionWithCallback({ callback: n, options: i }),
            'callback'
          ))
        : (o = a(
            () => this._transactionWithArray({ promises: n, options: i }),
            'callback'
          ))
      let s = {
        name: 'transaction',
        enabled: this._tracingConfig.enabled,
        attributes: { method: '$transaction' },
      }
      return me(s, o)
    }
    async _request(n) {
      n.otelParentCtx = Un.active()
      let i = {
          args: n.args,
          dataPath: n.dataPath,
          runInTransaction: Boolean(n.transaction),
          action: n.action,
          model: n.model,
        },
        o = {
          middleware: {
            name: 'middleware',
            enabled: this._tracingConfig.middleware,
            attributes: { method: '$use' },
            active: !1,
          },
          operation: {
            name: 'operation',
            enabled: this._tracingConfig.enabled,
            attributes: {
              method: i.action,
              model: i.model,
              name: `${i.model}.${i.action}`,
            },
          },
        },
        s = -1,
        l = a((u) => {
          let c = this._middlewares.get(++s)
          if (c) return me(o.middleware, (m) => c(u, (h) => (m?.end(), l(h))))
          let { runInTransaction: p, ...f } = u,
            d = { ...n, ...f }
          return p || (d.transaction = void 0), uc(this, d)
        }, 'consumer')
      return await me(o.operation, () =>
        new Hc.AsyncResource('prisma-client-request').runInAsyncScope(() =>
          l(i)
        )
      )
    }
    async _executeRequest({
      args: n,
      clientMethod: i,
      dataPath: o,
      callsite: s,
      action: l,
      model: u,
      argsMapper: c,
      transaction: p,
      unpacker: f,
      otelParentCtx: d,
      customDataProxyFetch: m,
    }) {
      try {
        let h = await this._getProtocolEncoder({ clientMethod: i, callsite: s })
        n = c ? c(n) : n
        let g = { name: 'serialize', enabled: this._tracingConfig.enabled },
          b
        u && ((b = rs(l, u, n, this._rejectOnNotFound)), Wh(b, u, l))
        let y = await me(g, () =>
          h.createMessage({
            modelName: u,
            action: l,
            args: n,
            clientMethod: i,
            callsite: s,
            extensions: this._extensions,
          })
        )
        return (
          U.enabled('prisma:client') &&
            (Re('Prisma Client call:'),
            Re(
              `prisma.${i}(${di({
                ast: n,
                keyPaths: [],
                valuePaths: [],
                missingItems: [],
              })})`
            ),
            Re('Generated request:'),
            Re(
              y.toDebugString() +
                `
`
            )),
          p?.kind === 'batch' && (await p.lock),
          this._fetcher.request({
            protocolMessage: y,
            protocolEncoder: h,
            modelName: u,
            clientMethod: i,
            dataPath: o,
            rejectOnNotFound: b,
            callsite: s,
            args: n,
            extensions: this._extensions,
            transaction: p,
            unpacker: f,
            otelParentCtx: d,
            otelChildCtx: Un.active(),
            customDataProxyFetch: m,
          })
        )
      } catch (h) {
        throw ((h.clientVersion = this._clientVersion), h)
      }
    }
    get $metrics() {
      if (!this._hasPreviewFlag('metrics'))
        throw new J(
          '`metrics` preview feature must be enabled in order to access metrics API'
        )
      return this._metrics
    }
    _hasPreviewFlag(n) {
      return !!this._engineConfig.previewFeatures?.includes(n)
    }
  }
  return a(t, 'PrismaClient'), t
}
a(Xc, 'getPrismaClient')
var Jc = ['$connect', '$disconnect', '$on', '$transaction', '$use', '$extends']
function fs(e, t) {
  return typeof e != 'object'
    ? e
    : new Proxy(e, {
        get: (r, n) => {
          if (!Jc.includes(n))
            return n === Gh
              ? t?.id
              : typeof r[n] == 'function'
              ? (...i) =>
                  n === 'then'
                    ? r[n](i[0], i[1], t)
                    : n === 'catch' || n === 'finally'
                    ? r[n](i[0], t)
                    : fs(r[n](...i), t)
              : fs(r[n], t)
        },
        has(r, n) {
          return Jc.includes(n) ? !1 : Reflect.has(r, n)
        },
      })
}
a(fs, 'transactionProxy')
var Kh = { findUnique: 'findUniqueOrThrow', findFirst: 'findFirstOrThrow' }
function Wh(e, t, r) {
  if (e) {
    let n = Kh[r],
      i = t ? `prisma.${Te(t)}.${n}` : `prisma.${n}`,
      o = `rejectOnNotFound.${t ?? ''}.${r}`
    Vo(
      o,
      `\`rejectOnNotFound\` option is deprecated and will be removed in Prisma 5. Please use \`${i}\` method instead`
    )
  }
}
a(Wh, 'warnAboutRejectOnNotFound')
var Jh = new Set([
  'toJSON',
  'asymmetricMatch',
  Symbol.iterator,
  Symbol.toStringTag,
  Symbol.isConcatSpreadable,
  Symbol.toPrimitive,
])
function Zc(e) {
  return new Proxy(e, {
    get(t, r) {
      if (r in t) return t[r]
      if (!Jh.has(r)) throw new TypeError(`Invalid enum value: ${String(r)}`)
    },
  })
}
a(Zc, 'makeStrictEnum')
var Tt = O(require('fs')),
  tp = O(require('path')),
  Ii = require('util')
var yO = (0, Ii.promisify)(Tt.default.readdir),
  bO = (0, Ii.promisify)(Tt.default.realpath),
  EO = (0, Ii.promisify)(Tt.default.stat),
  Hh = Tt.default.readdirSync,
  Yh = Tt.default.realpathSync,
  zh = Tt.default.statSync
function ep(e) {
  return e.isFile()
    ? 'f'
    : e.isDirectory()
    ? 'd'
    : e.isSymbolicLink()
    ? 'l'
    : void 0
}
a(ep, 'direntToType')
function Xh(e, t) {
  for (let r of t)
    if (typeof r == 'string') {
      if (e.includes(r)) return !0
    } else if (r.exec(e)) return !0
  return !1
}
a(Xh, 'isMatched')
function ds(
  e,
  t,
  r = ['f', 'd', 'l'],
  n = [],
  i = 1 / 0,
  o = () => !0,
  s = [],
  l = {}
) {
  try {
    let u = Yh(e)
    if (l[u] || i - s.length <= 0 || ep(zh(u)) !== 'd') return s
    let c = Hh(e, { withFileTypes: !0 })
    l[u] = !0
    for (let p of c) {
      let f = p.name,
        d = ep(p),
        m = tp.default.join(e, p.name)
      if (d && r.includes(d) && Xh(m, t)) {
        let h = o(e, f, d)
        typeof h == 'string' ? s.push(h) : h === !0 && s.push(m)
      }
      n.includes(d) && ds(m, t, r, n, i, o, s, l)
    }
  } catch {}
  return s
}
a(ds, 'findSync')
function rp(e) {
  Ur(e, { conflictCheck: 'warn' })
}
a(rp, 'warnEnvConflicts')
var Zh = np.decompressFromBase64
0 &&
  (module.exports = {
    DMMF,
    DMMFClass,
    Debug,
    Decimal,
    Engine,
    Extensions,
    MetricsClient,
    NotFoundError,
    PrismaClientInitializationError,
    PrismaClientKnownRequestError,
    PrismaClientRustPanicError,
    PrismaClientUnknownRequestError,
    PrismaClientValidationError,
    Sql,
    Types,
    decompressFromBase64,
    empty,
    findSync,
    getPrismaClient,
    join,
    makeDocument,
    makeStrictEnum,
    objectEnumValues,
    raw,
    sqltag,
    transformDocument,
    unpack,
    warnEnvConflicts,
  })
/*!
 *  decimal.js v10.4.3
 *  An arbitrary-precision Decimal type for JavaScript.
 *  https://github.com/MikeMcl/decimal.js
 *  Copyright (c) 2022 Michael Mclaughlin <M8ch88l@gmail.com>
 *  MIT Licence
 */
/*!
 * @description Recursive object extending
 * @author Viacheslav Lotsmanov <lotsmanov89@gmail.com>
 * @license MIT
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2013-2018 Viacheslav Lotsmanov
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
//# sourceMappingURL=library.js.map
