import type { Project } from '@coko/protocol'
import { toast } from '@coko/ui'
import * as React from 'react'
import { useChatStoreApi } from '../../app/chat.tsx'
import { useI18n } from '../../app/i18n.tsx'
import { useWorkbenchNavigation } from '../../app/workbench.tsx'
import { projectApi } from '../../client/api.ts'
import { ProjectFormDialog } from './project-form.tsx'

type CreateRequest = { onComplete?: (project: Project, status: 'created' | 'existing' | 'updated') => void }
type Request = CreateRequest & { project?: Project }
const EditProjectContext = React.createContext<((project: Project) => void) | null>(null)

export function useEditProject() {
  return React.useContext(EditProjectContext)
}

const ProjectDialogsContext = React.createContext<((request?: CreateRequest) => void) | null>(null)

export function useCreateProject() {
  return React.useContext(ProjectDialogsContext)
}

/** 弹窗宿主位于 App 层；完成动作由入口指定，Toast 不随表单卸载。 */
export function ProjectDialogsProvider({ pickDirectory, children }: { pickDirectory: () => Promise<string | null>; children: React.ReactNode }) {
  const [request, setRequest] = React.useState<Request | null>(null)
  const chat = useChatStoreApi()
  const navigation = useWorkbenchNavigation()
  const { t } = useI18n()
  return (
    <ProjectDialogsContext.Provider value={(next = {}) => setRequest(next)}>
      <EditProjectContext.Provider value={(project) => setRequest({ project })}>
        {children}
        {request && (
          <ProjectFormDialog
            mode={request.project ? 'edit' : 'create'}
            initial={request.project}
            pickDirectory={pickDirectory}
            onSubmit={request.project ? (fields) => projectApi.update(request.project!.id, fields) : projectApi.create}
            onClose={() => setRequest(null)}
            onComplete={(result) => {
              chat.lists.getState().upsertProject(result.project)
              setRequest(null)
              if (request.onComplete) request.onComplete(result.project, result.status)
              else if (result.status !== 'updated') navigation.newChat(result.project.primaryWorkspaceId)
              if (result.status === 'existing') toast.info(t('projectForm.existing', { name: result.project.name }))
            }}
          />
        )}
      </EditProjectContext.Provider>
    </ProjectDialogsContext.Provider>
  )
}
