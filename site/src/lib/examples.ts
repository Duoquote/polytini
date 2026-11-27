// Example lines for the demos, with where they come from.

/** Google's documented example, precision 5. */
export const GOOGLE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"

/**
 * A driving route through Berlin from the OSRM demo server, polyline6,
 * saved unchanged in polytini's test fixtures
 * (test/fixtures/presets/osrm-polyline6.json, fetched 2026-11-26).
 */
export const BERLIN =
  "sikdcBg`epXaFf@oEb@s@Fu@HYBaAJkJhAgYpCg@D_CRcCTe@DkSpBqEb@oBRkEb@wCgDqADcBJ_@BuHn@k@Dm@Fmd@tD]Dm@Hm@JkDtBgB\\mWxBC@qEb@u@vAOXO@oD\\iAJaAJyEb@kMjAyANwANw]hDiALsLjAaBRgEd@I@kZvCqD^eAJuANiBJySbAcJBqRvAyOx@i@Bc@@oId@eHJs@D]B_VhAaRrB]DyGp@qMrAgLjAaIp@uTdCuEd@}C\\uC`AS@aFbAOD_Dx@w@TmAZq@Duc@fDcA?wC]wBa@y@iHW}BuGqk@c@eEsAeL}@iHiAmJ_AuHqAiKuEa^WuB_@oCsDcY}@aHeAkIYcCmIwp@mC}TaEg]]oCEUWgC[gCK}@oAeK[cCcDaXIu@a@}C{BiQ]gCc@oDeAcHyAgJsDiVkB_McBuKkAoHaKso@}BePoCqQsGob@_DoSc@oCWqBcBgNGaCGgDE{BiA{h@c@iR[}Mo@{YGgCCgAWcMMmFe@kUeAab@XoENgFC_CWiOGmBE_BKiE[eK]eOo@{WeAac@GwCGsCOyGC}IHqCJsEx@aPp@qGhCoWxGcp@r@eHb@sENcBLwANgBJgAjFwi@lAeMxH}w@h@_G`CeWlLugAX{BpAuKZcC\\wCfA{IfAcJ\\kChAuIlAeJRwApEeg@z@mIj@mFj@eExCcQ~AyIfEuUv^arBnBgJz@gDvKg[pBgEhKsSr@uAhE_IxBmELWZo@LY|BgEsFyFw@}@g@g@k@o@iDoD_KcJq@g@kEgD_DcCwNcLaSuOyQ_QgAy@kE}CA}H?k@?e@BsLo@sSg@_QiBem@GwBSwGgCg{@MkEwBqs@]gLIwDLyFdAgJnJss@rCkKjAsHzEk[ZiBlBsM~@_GTuAt@qEnB}LJwAhBwTJ{IK{DWuDeAmHzBgBp@i@ZYp@o@rB{CbAiCbA_D`AeDfCaJbDgMp@}B`FcPjCsI~GcUdDwK`C_I`A_DtBuGfAmChBgD|MwVfDkGfCuEnA}BzEyI~HyNpCgFtEoIlBiDbEmHhJcQfIeOtFgKzBeEfBcDhE{HdCyEbAaB~AgBnAs@bDkA`BSdCMrBPdBh@rAl@|N`GjD~A~HjDvAn@dFvBrCpAhFbE`ExBtJrCdGpAb@Hj@HrBP~BRH~FBtCBhARjVTz^"

export type Example = {
  id: string
  label: string
  polyline: string
  preset: string
  credit: string
}

export const EXAMPLES: Example[] = [
  {
    id: "google",
    label: "Google's example",
    polyline: GOOGLE,
    preset: "google",
    credit:
      "From Google's Encoded Polyline Algorithm Format page, CC BY 4.0.",
  },
  {
    id: "berlin",
    label: "Berlin route (OSRM, polyline6)",
    polyline: BERLIN,
    preset: "osrm6",
    credit:
      "A route from the OSRM demo server, saved in polytini's test fixtures. Route data © OpenStreetMap contributors, ODbL.",
  },
]
