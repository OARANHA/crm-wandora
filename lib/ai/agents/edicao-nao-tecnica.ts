/**
 * A revogação de autonomia de IA congela campos TÉCNICOS, não o cadastro.
 * Permitir salvar uma edição não técnica sem revalidar a chave LEGADA da
 * instalação é seguro apenas quando a versão existente permanece tecnicamente
 * inalterada. Publicação conserva sua validação independente.
 */
export type EscolhaTecnicaDeAgente = {
  provider: string;
  model: string;
  credential_id: string;
  operator_model: string;
};

export function podePreservarChaveLegadaAoSalvar(args: {
  editandoAgente: boolean;
  temVersaoPersistida: boolean;
  podeEditarCredencial: boolean;
  antes: EscolhaTecnicaDeAgente;
  depois: EscolhaTecnicaDeAgente;
}): boolean {
  if (!args.editandoAgente || !args.temVersaoPersistida || args.podeEditarCredencial) return false;
  return (
    args.antes.provider === args.depois.provider &&
    args.antes.model === args.depois.model &&
    args.antes.credential_id === args.depois.credential_id &&
    args.antes.operator_model === args.depois.operator_model
  );
}
