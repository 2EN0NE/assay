import { ChevronDownIcon } from "@heroicons/react/20/solid"
import { Bars3Icon, ScaleIcon } from "@heroicons/react/24/outline"
import clsx from "clsx"
import { signOut, useSession } from "next-auth/react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/router"
import { ReactNode, useState } from "react"
import { toast } from "react-hot-toast"
import { api } from "../lib/web/trpc"
import { downloadBlob, signInToFatebook, useUserId } from "../lib/web/utils"
import Footer from "./Footer"
import NotificationsPopover from "./NotificationsPopover"
import { PromptDialog } from "./ui/PromptDialog"

export function Navbar({
  // eslint-disable-next-line no-unused-vars
  showForSlackButton = true,
  showCreateAccountButton = true,
  children,
}: {
  showForSlackButton?: boolean
  showCreateAccountButton?: boolean
  children: ReactNode
}) {
  const userId = useUserId()

  const menuItems = <MenuItems userId={userId ?? null} />

  return (
    <div className="drawer grow">
      <input id="my-drawer" type="checkbox" className="drawer-toggle" />
      <div className="drawer-content flex flex-col">
        <NavbarContent
          menuItems={menuItems}
          showCreateAccountButton={showCreateAccountButton}
        />
        {children}
      </div>
      <Drawer />
    </div>
  )
}

function NavbarContent({
  menuItems,
  showCreateAccountButton,
}: {
  menuItems: ReactNode
  showCreateAccountButton: boolean
}) {
  return (
    <div className="navbar max-w-5xl mx-auto">
      <div className="flex-none lg:hidden">
        <label htmlFor="my-drawer" className="btn btn-square btn-ghost">
          <Bars3Icon height={24} width={24} />
        </label>
      </div>
      <div className="flex-1 -ml-4 flex gap-0">
        <Link href="/" className="btn btn-ghost normal-case text-xl flex gap-2">
          <ScaleIcon className="w-6 h-6 text-indigo-600" />
          nano-fatebook-agent
        </Link>
      </div>
      <div className="flex-none hidden lg:block">
        <ul className="menu menu-horizontal">{menuItems}</ul>
      </div>
      <div className="">{AccountMenu(showCreateAccountButton)}</div>
    </div>
  )
}

function MenuItems({
  userId,
  isDrawer = false,
}: {
  userId: string | null
  isDrawer?: boolean
}) {
  const router = useRouter()
  const isActive = (path: string) => router.pathname === path
  const { status: sessionStatus } = useSession()
  const exportData = useExportData()

  return (
    <>
      <li>
        <Link href="/about" className={isActive("/about") ? "bg-base-200" : ""}>
          About
        </Link>
      </li>
      <li>
        <Link href="/blog" className={isActive("/blog") ? "bg-base-200" : ""}>
          Blog
        </Link>
      </li>
      {isDrawer ? (
        <>
          <li className="menu-title text-lg mt-2 leading-4">Learn</li>
          <LearnItems />
        </>
      ) : (
        <>
          <li>
            <LearnDropdown />
          </li>
        </>
      )}
      <li>
        <a onClick={() => !exportData.isLoading && exportData.mutate()}>
          {exportData.isLoading ? "Exporting..." : "Export predictions"}
        </a>
      </li>
      {userId ? (
        <li className="hidden lg:block">
          <NotificationsPopover />
        </li>
      ) : (
        <span
          className={clsx(sessionStatus === "loading" && "sm:w-[3.25rem]")}
        />
      )}
    </>
  )
}

function LearnDropdown() {
  return (
    <div className="dropdown dropdown-hover dropdown-bottom dropdown-end">
      <label className="flex gap-1" tabIndex={0}>
        <ChevronDownIcon className="text-neutral-400" width={16} /> Learn
      </label>
      <ul
        tabIndex={0}
        className="dropdown-content z-[9999] menu p-2 shadow-lg bg-base-100 rounded-box w-64"
      >
        <LearnItems />
      </ul>
    </div>
  )
}

function LearnItems() {
  return (
    <>
      <li className="menu-title">Training tools</li>
      <li>
        <Link href="https://www.quantifiedintuitions.org/calibration">
          Calibration training
        </Link>
      </li>
      <li>
        <Link href="https://www.quantifiedintuitions.org/pastcasting">
          Pastcasting
        </Link>
      </li>
      <li>
        <Link href="https://www.quantifiedintuitions.org/estimation-game">
          The Estimation Game
        </Link>
      </li>
      <li>
        <Link href="https://www.quantifiedintuitions.org/anki-with-uncertainty">
          Anki with Uncertainty
        </Link>
      </li>
      <li className="menu-title">More resources</li>
      {/* <li>
        <Link href="/tips-on-writing-questions" className={isActive('/tips-on-writing-questions') ? 'bg-base-200' : ''}>Tips on writing questions</Link>
      </li> */}
    </>
  )
}

function Drawer() {
  return (
    <div className="drawer-side z-[9999] mt-16 lg:hidden">
      <label htmlFor="my-drawer" className="drawer-overlay"></label>
      <ul className="menu flex flex-col flex-nowrap p-4 w-80 overflow-auto bg-neutral-100 h-full text-md text-neutral-600 font-semibold">
        <div className="overflow-y-auto flex-shrink pb-8">
          <MenuItems userId={null} isDrawer={true} />
        </div>
        <div className="grow" />
        <div className="-m-4 mb-8 z-10">
          <Footer />
        </div>
      </ul>
    </div>
  )
}

function useExportData() {
  return api.question.exportAllQuestions.useMutation({
    onSuccess(data) {
      if (!data || data === "") {
        alert("Nothing to export! Make some forecasts first?")
        return
      }
      downloadBlob(
        data,
        "nano-fatebook-agent-forecasts.csv",
        "text/csv;charset=utf-8;",
      )
    },
  })
}

function AccountMenu(showCreateAccountButton: boolean) {
  const { data: session, status, update } = useSession()
  const router = useRouter()
  const [editNameDialogOpen, setEditNameDialogOpen] = useState(false)
  const [editImageDialogOpen, setEditImageDialogOpen] = useState(false)

  const user = {
    name: session?.user?.name ?? "",
    email: session?.user?.email ?? "",
    imageUrl: session?.user?.image ?? "/default_avatar.png",
  }

  const editName = api.editName.useMutation()

  // Show welcome dialog for new users without a username
  const showWelcomeDialog = user.email && !user.name

  if (status === "loading") {
    return (
      <details className="dropdown dropdown-end">
        <summary
          tabIndex={0}
          className="btn btn-ghost btn-circle avatar hover:bg-opacity-0 hover:scale-[1.03]"
        >
          <div className="w-10 h-10 rounded-full bg-neutral-500 opacity-50" />
        </summary>
        <ul
          tabIndex={0}
          className="menu menu-sm dropdown-content mt-1 p-2 shadow bg-base-100 rounded-box w-52"
        >
          <li className="px-3 py-2 text-neutral-500 select-none">Loading...</li>
        </ul>
      </details>
    )
  }

  return user.email ? (
    <>
      <details className="dropdown dropdown-end z-[9999]">
        <summary
          tabIndex={0}
          className="btn btn-ghost btn-circle avatar hover:bg-opacity-0 hover:scale-[1.03]"
        >
          <div className="w-10 rounded-full">
            <Image src={user.imageUrl} width={40} height={40} alt={user.name} />
          </div>
        </summary>
        <ul
          tabIndex={0}
          className="menu menu-sm dropdown-content mt-1 p-2 shadow bg-base-100 rounded-box w-64"
        >
          <li className="px-3 py-2 text-neutral-500 select-none break-all">
            Signed in as {user.email}
          </li>
          <li onClick={() => setEditNameDialogOpen(true)}>
            <a>Change your username</a>
          </li>
          <li onClick={() => setEditImageDialogOpen(true)}>
            <a>Change your profile picture</a>
          </li>
          <li onClick={() => void signOut({ redirect: true })}>
            <a>Logout</a>
          </li>
        </ul>
      </details>

      <PromptDialog
        isOpen={showWelcomeDialog || editNameDialogOpen}
        onClose={() => setEditNameDialogOpen(false)}
        title={
          showWelcomeDialog ? "Choose your display name" : "Change display name"
        }
        description={
          showWelcomeDialog
            ? "You can enter your name or a psuedonym"
            : "Enter your new display name"
        }
        defaultValue={
          user.name
            ? user.name
            : user.email
              ? user.email
                  .split("@")[0]
                  .replace(/\./g, " ")
                  .split(" ")
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(" ")
              : ""
        }
        submitLabel="Save"
        showCloseButtons={!showWelcomeDialog}
        onSubmit={(newName) => {
          if (newName) {
            void (async () => {
              await editName.mutateAsync({ newName })
              await update({ user: { name: newName } })
              router.reload()
            })()
          }
        }}
      />

      <PromptDialog
        isOpen={editImageDialogOpen}
        onClose={() => setEditImageDialogOpen(false)}
        title="Change profile picture"
        description="Enter the URL of your new profile picture. You can upload it to a site like imgur.com. Make sure you right click the uploaded image and 'Copy image address' if pasting from imgur."
        defaultValue={user.imageUrl}
        submitLabel="Save"
        onSubmit={(newImage) => {
          if (newImage) {
            editName.mutate({ newImage })
            toast.success(
              "Profile picture updated! Sign in again to see the change.",
            )
            setTimeout(() => {
              void signOut()
            }, 2000)
          }
        }}
      />
    </>
  ) : (
    showCreateAccountButton && (
      <button className="btn" onClick={() => void signInToFatebook()}>
        Log in or sign up
      </button>
    )
  )
}

// eslint-disable-next-line no-unused-vars
function NewDot() {
  return <div className="w-2 h-2 ml-0.5 my-auto bg-indigo-400 rounded-full" />
}
